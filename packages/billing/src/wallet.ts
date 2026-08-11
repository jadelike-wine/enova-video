import { and, eq } from 'drizzle-orm';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { wallets, walletLedger, type Database } from '@enova/db';

/**
 * 纯余额运算（无副作用，便于单测）。
 * 所有金额为整数 Credits，禁止浮点。
 */
export function computeReserve(balance: number, reserved: number, credits: number): {
  ok: boolean;
  balanceAfter: number;
  reservedAfter: number;
} {
  if (balance < credits) return { ok: false, balanceAfter: balance, reservedAfter: reserved };
  return { ok: true, balanceAfter: balance - credits, reservedAfter: reserved + credits };
}

/** 结算：actual 从 reserved 消耗，剩余退回 balance。actual 永远不超过 reserved。 */
export function computeSettle(
  _balance: number,
  reserved: number,
  actual: number,
): { reservedAfter: number; released: number } {
  const actualSafe = Math.min(Math.max(0, actual), reserved);
  const released = reserved - actualSafe;
  return { reservedAfter: 0, released };
}

/** 失败回滚：全部 reserved 退回 balance。 */
export function computeRelease(balance: number, reserved: number): {
  balanceAfter: number;
  reservedAfter: number;
  released: number;
} {
  return { balanceAfter: balance + reserved, reservedAfter: 0, released: reserved };
}

/** 事务句柄（Drizzle 的事务回调第一参数）。 */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Wallet 操作：Reserve / Settle / Release。
 *
 * 供 API 与 Worker 共享，保证计费逻辑唯一一致。
 * - 全部在事务内 + 行锁（SELECT ... FOR UPDATE）防止并发超卖。
 * - 每笔变化写 WalletLedger，用 idempotency_key 保证 Worker 重试不重复扣费。
 * - 同一 GenerationJob 只能 settle/release 一次。
 *
 * 本类不依赖 NestJS，可直接实例化（传入 Database）。
 */
export class WalletGateway {
  constructor(private readonly db: Database) {}

  /** 创建任务时预留 credits：balance 减少、reserved 增加。 */
  reserve(workspaceId: string, generationJobId: string, credits: number, idempotencyKey: string): Promise<{ balance: number; reserved: number }> {
    return this.db.transaction((tx) => this.reserveInTx(tx, workspaceId, generationJobId, credits, idempotencyKey));
  }

  /** 供组合事务复用：在同一事务内 reserve + 写 ledger。 */
  async reserveInTx(
    tx: Tx,
    workspaceId: string,
    generationJobId: string,
    credits: number,
    idempotencyKey: string,
  ): Promise<{ balance: number; reserved: number }> {
    if (credits <= 0) throw domainError(ERROR_CODES.VALIDATION_ERROR, 'credits must be positive', 400);

    const rows = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.workspaceId, workspaceId))
      .for('update');
    const wallet = rows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    const calc = computeReserve(wallet.balance, wallet.reservedBalance, credits);
    if (!calc.ok) {
      throw domainError(
        ERROR_CODES.INSUFFICIENT_CREDITS,
        'Insufficient credits',
        402,
        { need: credits, available: wallet.balance },
      );
    }

    await tx
      .update(wallets)
      .set({ balance: calc.balanceAfter, reservedBalance: calc.reservedAfter, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'GENERATION_RESERVE',
      amount: -credits,
      balanceBefore: wallet.balance,
      balanceAfter: calc.balanceAfter,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: calc.reservedAfter,
      generationJobId,
      idempotencyKey,
      description: `Reserve ${credits} credits for generation`,
    });

    return { balance: calc.balanceAfter, reserved: calc.reservedAfter };
  }

  /** 结算：把 actual 从 reserved 消耗，剩余 reserved 退回 balance。仅能执行一次。 */
  settle(workspaceId: string, generationJobId: string, actualCredits: number, idempotencyKey: string): Promise<void> {
    return this.db.transaction((tx) => this.settleInTx(tx, workspaceId, generationJobId, actualCredits, idempotencyKey));
  }

  /**
   * 结算（供组合事务复用）：与 Worker 的 Asset/Usage/Job 状态更新在同一事务内提交，
   * 保证「资源已落库 + 已结算 + 已标记完成」原子一致；幂等由 idempotency_key 保证。
   */
  async settleInTx(
    tx: Tx,
    workspaceId: string,
    generationJobId: string,
    actualCredits: number,
    idempotencyKey: string,
  ): Promise<void> {
    if (await this.hasLedger(tx, idempotencyKey, generationJobId)) return; // 幂等：已结算

    const rows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = rows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    const calc = computeSettle(wallet.balance, wallet.reservedBalance, actualCredits);

    await tx
      .update(wallets)
      .set({ balance: wallet.balance + calc.released, reservedBalance: calc.reservedAfter, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'GENERATION_SETTLE',
      amount: 0,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: calc.reservedAfter,
      generationJobId,
      idempotencyKey,
      description: `Settle ${actualCredits} credits for generation`,
    });

    if (calc.released > 0) {
      await tx.insert(walletLedger).values({
        workspaceId,
        type: 'GENERATION_RELEASE',
        amount: calc.released,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance + calc.released,
        reservedBefore: calc.reservedAfter,
        reservedAfter: 0,
        generationJobId,
        idempotencyKey: `${idempotencyKey}:release`,
        description: `Release ${calc.released} unused credits`,
      });
    }
  }

  /** 失败回滚：释放全部 reserved 回 balance。仅能执行一次。 */
  release(workspaceId: string, generationJobId: string, idempotencyKey: string): Promise<void> {
    return this.db.transaction((tx) => this.releaseInTx(tx, workspaceId, generationJobId, idempotencyKey));
  }

  /**
   * 失败回滚（供组合事务复用）：与 Worker 的 Job 状态更新在同一事务内提交，
   * 保证「标记 FAILED + 释放全部 reserved」原子一致；幂等由 idempotency_key 保证。
   */
  async releaseInTx(
    tx: Tx,
    workspaceId: string,
    generationJobId: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (await this.hasLedger(tx, idempotencyKey, generationJobId)) return; // 幂等

    const rows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = rows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    const calc = computeRelease(wallet.balance, wallet.reservedBalance);

    await tx
      .update(wallets)
      .set({ balance: calc.balanceAfter, reservedBalance: 0, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'GENERATION_RELEASE',
      amount: calc.released,
      balanceBefore: wallet.balance,
      balanceAfter: calc.balanceAfter,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: 0,
      generationJobId,
      idempotencyKey,
      description: `Release ${calc.released} reserved credits on failure`,
    });
  }

  /**
   * 管理员调整余额（正负均可，仅作用于 balance，不涉及 reserved）。
   * 写入 ADMIN_ADJUSTMENT ledger；幂等由 idempotencyKey 唯一约束保证。
   * 负数不能使余额为负。
   */
  adjustBalance(workspaceId: string, delta: number, idempotencyKey: string, description?: string): Promise<{ balance: number }> {
    return this.db.transaction((tx) => this.adjustBalanceInTx(tx, workspaceId, delta, idempotencyKey, description));
  }

  /** 管理员调整余额（供组合事务复用）。 */
  async adjustBalanceInTx(
    tx: Tx,
    workspaceId: string,
    delta: number,
    idempotencyKey: string,
    description?: string,
  ): Promise<{ balance: number }> {
    if (delta === 0) throw domainError(ERROR_CODES.VALIDATION_ERROR, 'adjustment delta must be non-zero', 400);

    const rows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = rows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    const balanceAfter = wallet.balance + delta;
    if (balanceAfter < 0) {
      throw domainError(ERROR_CODES.NEGATIVE_BALANCE, 'Balance cannot be negative', 400, { balance: wallet.balance, delta });
    }

    await tx
      .update(wallets)
      .set({ balance: balanceAfter, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'ADMIN_ADJUSTMENT',
      amount: delta,
      balanceBefore: wallet.balance,
      balanceAfter,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: wallet.reservedBalance,
      idempotencyKey,
      description: description ?? 'Admin balance adjustment',
    });

    return { balance: balanceAfter };
  }

  /** 幂等检查：该 key 或该 job 是否已有对应 ledger 记录。 */
  private async hasLedger(
    tx: Tx,
    idempotencyKey: string,
    generationJobId: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: walletLedger.id })
      .from(walletLedger)
      .where(
        and(
          eq(walletLedger.idempotencyKey, idempotencyKey),
          eq(walletLedger.generationJobId, generationJobId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * 充值入账（Phase 7）：按订单向已存在的 Wallet 增加可用余额。
   * - 写入 RECHARGE ledger，携带 orderId。
   * - 幂等由 idempotencyKey 唯一约束保证：同一订单回调重复到达不会重复入账。
   * - 仅作用于 balance（可用余额），不涉及 reserved。
   */
  recharge(
    workspaceId: string,
    credits: number,
    orderId: string,
    idempotencyKey: string,
    description?: string,
  ): Promise<{ balance: number }> {
    return this.db.transaction((tx) => this.rechargeInTx(tx, workspaceId, credits, orderId, idempotencyKey, description));
  }

  /** 充值入账（供组合事务复用）。 */
  async rechargeInTx(
    tx: Tx,
    workspaceId: string,
    credits: number,
    orderId: string,
    idempotencyKey: string,
    description?: string,
  ): Promise<{ balance: number }> {
    if (!Number.isInteger(credits) || credits <= 0) {
      throw domainError(ERROR_CODES.PAYMENT_CREDITS_NOT_POSITIVE, 'recharge credits must be a positive integer', 400);
    }

    // 幂等：该 idempotencyKey 已入账则直接返回当前余额，避免订单重复回调重复充值。
    const existing = await tx
      .select({ id: walletLedger.id })
      .from(walletLedger)
      .where(eq(walletLedger.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing.length > 0) {
      const w = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).limit(1);
      return { balance: w[0]?.balance ?? 0 };
    }

    const rows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = rows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    const balanceAfter = wallet.balance + credits;

    await tx
      .update(wallets)
      .set({ balance: balanceAfter, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'RECHARGE',
      amount: credits,
      balanceBefore: wallet.balance,
      balanceAfter,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: wallet.reservedBalance,
      orderId,
      idempotencyKey,
      description: description ?? `Recharge ${credits} credits`,
    });

    return { balance: balanceAfter };
  }
}