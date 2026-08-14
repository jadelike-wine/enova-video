import { and, eq } from 'drizzle-orm';
import { domainError, ERROR_CODES } from '@enova/contracts';
import {
  creditReservations,
  wallets,
  walletLedger,
  type Database,
} from '@enova/db';

/**
 * 纯余额运算（无副作用，便于单测）。
 * 所有金额为整数 Credits，禁止浮点。
 */

/**
 * Reserve 计算：从可用余额扣除 credits，加入预留池。
 * 与旧版一致——wallet 级别的聚合计算不变。
 */
export function computeReserve(balance: number, reserved: number, credits: number): {
  ok: boolean;
  balanceAfter: number;
  reservedAfter: number;
} {
  if (balance < credits) return { ok: false, balanceAfter: balance, reservedAfter: reserved };
  return { ok: true, balanceAfter: balance - credits, reservedAfter: reserved + credits };
}

/**
 * Capture 计算（per-job）：在单个 reservation 上结算 actual credits。
 * - remaining = reserved - captured - released（该 job 尚未结算的额度）
 * - captureAmount = min(actual, remaining)（不能超结）
 * - releaseAmount = remaining - captureAmount（未用部分退回 balance）
 *
 * 关键不变量：capture 只影响 THIS job 的 reservation，不会触碰其他 job。
 */
export function computeCapture(
  reserved: number,
  captured: number,
  released: number,
  actualCredits: number,
): {
  remaining: number;
  captureAmount: number;
  releaseAmount: number;
  newCaptured: number;
  newReleased: number;
} {
  const remaining = Math.max(0, reserved - captured - released);
  const captureAmount = Math.min(Math.max(0, actualCredits), remaining);
  const releaseAmount = remaining - captureAmount;
  return {
    remaining,
    captureAmount,
    releaseAmount,
    newCaptured: captured + captureAmount,
    newReleased: released + releaseAmount,
  };
}

/**
 * Release 计算（per-job）：释放该 job reservation 的全部剩余额度。
 * 只释放 remaining = reserved - captured - released，不影响其他 job。
 */
export function computeReleaseForJob(
  reserved: number,
  captured: number,
  released: number,
): { remaining: number; releaseAmount: number; newReleased: number } {
  const remaining = Math.max(0, reserved - captured - released);
  return {
    remaining,
    releaseAmount: remaining,
    newReleased: released + remaining,
  };
}

/** 事务句柄（Drizzle 的事务回调第一参数）。 */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Wallet 操作：Reserve / Capture / Release。
 *
 * P0-1 修复：每个 GenerationJob 拥有独立的 CreditReservation 行，
 * settle/release 只操作该 job 的 reservation，不再触碰聚合 reserved_balance。
 *
 * 保障：
 * - 全部在事务内 + 行锁（SELECT ... FOR UPDATE）防止并发超卖。
 * - credit_reservations.generation_job_id UNIQUE → 一个 job 最多一个 reservation。
 * - credit_reservations.idempotency_key UNIQUE → 重复 reserve 幂等。
 * - wallet_ledger.idempotency_key UNIQUE → 重复 settle/release 幂等。
 * - captured + released <= reserved（DB CHECK 约束）。
 *
 * 本类不依赖 NestJS，可直接实例化（传入 Database）。
 */
export class WalletGateway {
  constructor(private readonly db: Database) {}

  // ---- RESERVE ----

  /** 创建任务时预留 credits：balance 减少、reserved 增加、创建 reservation 行。 */
  reserve(workspaceId: string, generationJobId: string, credits: number, idempotencyKey: string): Promise<{ balance: number; reserved: number }> {
    return this.db.transaction((tx) => this.reserveInTx(tx, workspaceId, generationJobId, credits, idempotencyKey));
  }

  /** 供组合事务复用：在同一事务内 reserve + 写 ledger + 创建 reservation。 */
  async reserveInTx(
    tx: Tx,
    workspaceId: string,
    generationJobId: string,
    credits: number,
    idempotencyKey: string,
  ): Promise<{ balance: number; reserved: number }> {
    if (!Number.isInteger(credits) || credits <= 0) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'credits must be a positive integer', 400);
    }

    // Lock wallet row FIRST（对同一 wallet 的并发 reserve 在此串行化）。
    const rows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = rows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    // 幂等：该 job 已有 reservation 则直接返回（不重复扣费）。
    // P0 红队修复：幂等检查必须在拿到 FOR UPDATE 锁之后再执行。
    // 原来在锁之前查询，两个并发 reserve(同一 job) 会同时看到"无 reservation"→ 各自插入 →
    // 触发 generation_job_id 唯一约束冲突（原始 unique violation）。上锁后重查才是真正的幂等：
    // 第二个事务会阻塞在行锁上，待第一个提交后再执行本处检查，命中已有 reservation 直接返回。
    const existingRes = await tx
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.generationJobId, generationJobId))
      .limit(1);
    if (existingRes.length > 0) {
      // 已有 reservation：返回锁内读取的 wallet 状态。
      return { balance: wallet.balance, reserved: wallet.reservedBalance };
    }

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

    // 创建 per-job reservation 行。
    await tx.insert(creditReservations).values({
      walletId: wallet.id,
      workspaceId,
      generationJobId,
      reservedCredits: credits,
      capturedCredits: 0,
      releasedCredits: 0,
      status: 'RESERVED',
      idempotencyKey,
    });

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

  // ---- CAPTURE (settle) ----

  /**
   * 结算：把 actualCredits 从该 job 的 reservation 中消耗，剩余退回 balance。
   * 只操作该 job 的 reservation，不影响其他 job 的预留额度。
   * 幂等：已 CAPTURED 或 ledger 已存在则跳过。
   */
  capture(workspaceId: string, generationJobId: string, actualCredits: number, idempotencyKey: string): Promise<void> {
    return this.db.transaction((tx) => this.captureInTx(tx, workspaceId, generationJobId, actualCredits, idempotencyKey));
  }

  /** 旧接口别名（向后兼容 worker 现有调用）。 */
  settle(workspaceId: string, generationJobId: string, actualCredits: number, idempotencyKey: string): Promise<void> {
    return this.capture(workspaceId, generationJobId, actualCredits, idempotencyKey);
  }

  /** 旧接口别名（向后兼容 worker 现有调用）。 */
  settleInTx(tx: Tx, workspaceId: string, generationJobId: string, actualCredits: number, idempotencyKey: string): Promise<void> {
    return this.captureInTx(tx, workspaceId, generationJobId, actualCredits, idempotencyKey);
  }

  async captureInTx(
    tx: Tx,
    workspaceId: string,
    generationJobId: string,
    actualCredits: number,
    idempotencyKey: string,
  ): Promise<void> {
    if (!Number.isInteger(actualCredits) || actualCredits < 0) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'actualCredits must be a non-negative integer', 400);
    }

    // Lock THIS job's reservation.
    const resRows = await tx
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.generationJobId, generationJobId))
      .for('update');
    const reservation = resRows[0];
    if (!reservation) {
      // 无 reservation：可能是已 settle/release 的旧 job，检查 ledger 幂等。
      if (await this.hasLedger(tx, idempotencyKey, generationJobId)) return;
      throw domainError(ERROR_CODES.NOT_FOUND, 'Credit reservation not found for job', 404);
    }

    // 幂等：已 CAPTURED。
    if (reservation.status === 'CAPTURED') return;
    // 已 RELEASED 的 reservation 不能再 capture。
    if (reservation.status === 'RELEASED') {
      throw domainError(
        ERROR_CODES.GENERATION_ALREADY_SETTLED,
        'Cannot capture a released reservation',
        409,
      );
    }

    // Ledger 幂等。
    if (await this.hasLedger(tx, idempotencyKey, generationJobId)) return;

    // Lock wallet.
    const wRows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = wRows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    const calc = computeCapture(
      reservation.reservedCredits,
      reservation.capturedCredits,
      reservation.releasedCredits,
      actualCredits,
    );

    // wallet: reservedBalance 减少 remaining（该 reservation 完全脱离预留池），
    //         balance 增加 releaseAmount（未用部分退回）。
    const newReserved = wallet.reservedBalance - calc.remaining;
    const newBalance = wallet.balance + calc.releaseAmount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, reservedBalance: newReserved, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    // 更新 reservation。
    await tx
      .update(creditReservations)
      .set({
        capturedCredits: calc.newCaptured,
        releasedCredits: calc.newReleased,
        status: 'CAPTURED',
        settledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditReservations.id, reservation.id));

    // SETTLE ledger：记录结算（capture 本身不改变 balance——credits 在 reserve 时已扣）。
    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'GENERATION_SETTLE',
      amount: 0,
      balanceBefore: wallet.balance,
      balanceAfter: newBalance,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: newReserved,
      generationJobId,
      idempotencyKey,
      description: `Capture ${calc.captureAmount} credits (released ${calc.releaseAmount} unused)`,
    });

    if (calc.releaseAmount > 0) {
      await tx.insert(walletLedger).values({
        workspaceId,
        type: 'GENERATION_RELEASE',
        amount: calc.releaseAmount,
        balanceBefore: wallet.balance,
        balanceAfter: newBalance,
        reservedBefore: wallet.reservedBalance,
        reservedAfter: newReserved,
        generationJobId,
        idempotencyKey: `${idempotencyKey}:release`,
        description: `Release ${calc.releaseAmount} unused credits`,
      });
    }
  }

  // ---- RELEASE ----

  /**
   * 释放该 job 的全部剩余预留 credits。
   * P0-1 关键修复：只释放 THIS job 的 reservation.remaining，不再清空整个 reserved_balance。
   * 幂等：已 RELEASED 则跳过。
   */
  release(workspaceId: string, generationJobId: string, idempotencyKey: string): Promise<void> {
    return this.db.transaction((tx) => this.releaseInTx(tx, workspaceId, generationJobId, idempotencyKey));
  }

  async releaseInTx(
    tx: Tx,
    workspaceId: string,
    generationJobId: string,
    idempotencyKey: string,
  ): Promise<void> {
    // Lock THIS job's reservation.
    const resRows = await tx
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.generationJobId, generationJobId))
      .for('update');
    const reservation = resRows[0];
    if (!reservation) {
      // 无 reservation：检查 ledger 幂等（可能是旧流程）。
      if (await this.hasLedger(tx, idempotencyKey, generationJobId)) return;
      // 无 reservation 也无 ledger：静默返回（job 可能从未 reserve 过，如 cancel 未运行 job）。
      return;
    }

    // 幂等：已 RELEASED。
    if (reservation.status === 'RELEASED') return;

    // Ledger 幂等。
    if (await this.hasLedger(tx, idempotencyKey, generationJobId)) return;

    // Lock wallet.
    const wRows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = wRows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    const calc = computeReleaseForJob(
      reservation.reservedCredits,
      reservation.capturedCredits,
      reservation.releasedCredits,
    );

    if (calc.releaseAmount === 0) {
      // 已无剩余可释放（全部 captured）：标记 RELEASED 即可。
      await tx
        .update(creditReservations)
        .set({ status: 'RELEASED', updatedAt: new Date() })
        .where(eq(creditReservations.id, reservation.id));
      return;
    }

    // wallet: reservedBalance 减少 releaseAmount，balance 增加 releaseAmount。
    const newReserved = wallet.reservedBalance - calc.releaseAmount;
    const newBalance = wallet.balance + calc.releaseAmount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, reservedBalance: newReserved, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    // 更新 reservation。
    await tx
      .update(creditReservations)
      .set({
        releasedCredits: calc.newReleased,
        status: 'RELEASED',
        updatedAt: new Date(),
      })
      .where(eq(creditReservations.id, reservation.id));

    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'GENERATION_RELEASE',
      amount: calc.releaseAmount,
      balanceBefore: wallet.balance,
      balanceAfter: newBalance,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: newReserved,
      generationJobId,
      idempotencyKey,
      description: `Release ${calc.releaseAmount} reserved credits`,
    });
  }

  // ---- ADMIN ADJUST ----

  /**
   * 管理员调整余额（正负均可，仅作用于 balance，不涉及 reserved）。
   * 写入 ADMIN_ADJUSTMENT ledger；幂等由 idempotencyKey 唯一约束保证。
   * 负数不能使余额为负。
   */
  adjustBalance(workspaceId: string, delta: number, idempotencyKey: string, description?: string): Promise<{ balance: number }> {
    return this.db.transaction((tx) => this.adjustBalanceInTx(tx, workspaceId, delta, idempotencyKey, description));
  }

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

  // ---- RECHARGE ----

  /**
   * 充值入账：按订单向已存在的 Wallet 增加可用余额。
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

  // ---- MANUAL REFUND CREDITS REVOCATION ----

  /**
   * 人工退款 Credits 冲正：在事务内从钱包余额扣除 credits，写入 REFUND ledger。
   *
   * - amount 为负数（冲正）
   * - ledger type = REFUND
   * - 必须带 orderId、workspaceId
   * - 幂等由 idempotencyKey 唯一约束保证（type=REFUND + idempotencyKey）
   * - 余额不足时抛出 NEGATIVE_BALANCE，**不**写负余额
   *
   * 并发幂等保障：
   * 1. 先锁 wallet 行（SELECT ... FOR UPDATE），串行化对同一 wallet 的并发 refund。
   * 2. 锁后重新检查幂等：如果另一个事务在锁释放前已插入相同 idempotencyKey 的 REFUND ledger，
   *    当前事务会检测到并直接返回（不重复扣减）。
   * 3. 幂等查询限定 type = 'REFUND'，避免非 REFUND 类型的同名 idempotencyKey 误判。
   *
   * 调用方应在 catch 中将退款记录标记为 CREDITS_PENDING。
   */
  async refundCreditsInTx(
    tx: Tx,
    workspaceId: string,
    creditsToRevoke: number,
    orderId: string,
    idempotencyKey: string,
    description?: string,
  ): Promise<{ balance: number }> {
    if (!Number.isInteger(creditsToRevoke) || creditsToRevoke <= 0) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'creditsToRevoke must be a positive integer', 400);
    }

    // Lock wallet row FIRST — serializes concurrent refund operations on the same wallet.
    // P0 fix: idempotency check must happen AFTER acquiring the FOR UPDATE lock.
    // Previously the check was before the lock: two concurrent transactions would both
    // see "no existing ledger" → both proceed to insert → unique constraint violation
    // on one side (instead of graceful idempotent return).
    const rows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
    const wallet = rows[0];
    if (!wallet) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

    // Idempotency (post-lock): if a REFUND ledger with this idempotencyKey already exists,
    // the revocation was already applied — return current balance without re-deducting.
    // Filter by type = 'REFUND' to avoid false positives from non-REFUND ledgers
    // that happen to share the same idempotencyKey.
    const existing = await tx
      .select({ id: walletLedger.id })
      .from(walletLedger)
      .where(
        and(
          eq(walletLedger.idempotencyKey, idempotencyKey),
          eq(walletLedger.type, 'REFUND'),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return { balance: wallet.balance };
    }

    const balanceAfter = wallet.balance - creditsToRevoke;
    if (balanceAfter < 0) {
      throw domainError(
        ERROR_CODES.NEGATIVE_BALANCE,
        'Balance cannot be negative — credits insufficient for manual refund revocation',
        400,
        { balance: wallet.balance, creditsToRevoke },
      );
    }

    await tx
      .update(wallets)
      .set({ balance: balanceAfter, updatedAt: new Date() })
      .where(eq(wallets.workspaceId, workspaceId));

    await tx.insert(walletLedger).values({
      workspaceId,
      type: 'REFUND',
      amount: -creditsToRevoke,
      balanceBefore: wallet.balance,
      balanceAfter,
      reservedBefore: wallet.reservedBalance,
      reservedAfter: wallet.reservedBalance,
      orderId,
      idempotencyKey,
      description: description ?? `Manual refund: revoke ${creditsToRevoke} credits`,
    });

    return { balance: balanceAfter };
  }

  // ---- HELPERS ----

  /** 幂等检查：该 key + job 是否已有对应 ledger 记录。 */
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

  // ---- RESERVATION INVARIANT (Wallet.reserved_balance == SUM residual) ----

  /**
   * 核对不变量：wallet.reserved_balance == SUM(active reservation remaining)
   * 其中 remaining = reserved - captured - released（该 reservation 尚未脱离预留池的额度）。
   *
   * 只读检测，不自动修账。返回所有发生 drift 的 wallet（含 expected 值）。
   * 由 reconciliation 定时任务调用，产出 structured 结果供 log/metric/告警。
   */
  async checkReservationInvariant(): Promise<
    Array<{ workspaceId: string; reservedBalance: number; expectedReserved: number }>
  > {
    const walletRows = await this.db.select().from(wallets);
    const mismatches: Array<{ workspaceId: string; reservedBalance: number; expectedReserved: number }> = [];

    for (const w of walletRows) {
      const resRows = await this.db
        .select({
          reserved: creditReservations.reservedCredits,
          captured: creditReservations.capturedCredits,
          released: creditReservations.releasedCredits,
        })
        .from(creditReservations)
        .where(eq(creditReservations.walletId, w.id));

      const expected = resRows.reduce(
        (sum, r) => sum + Math.max(0, r.reserved - r.captured - r.released),
        0,
      );
      if (w.reservedBalance !== expected) {
        mismatches.push({ workspaceId: w.workspaceId, reservedBalance: w.reservedBalance, expectedReserved: expected });
      }
    }
    return mismatches;
  }

  /**
   * 显式修复某 wallet 的 reserved_balance 漂移（不自动触发，需显式调用）。
   * - 在事务内将 reserved_balance 校正为 SUM(residual)。
   * - 写入 wallet_ledger（ADMIN_ADJUSTMENT，amount=0，描述携带 reason/requestId/before/after）作为审计。
   * - 幂等：若已一致则直接返回，不写 ledger。
   */
  async repairReservationInvariant(
    workspaceId: string,
    reason: string,
    requestId: string,
  ): Promise<{ before: number; after: number }> {
    return this.db.transaction(async (tx) => {
      const wRows = await tx.select().from(wallets).where(eq(wallets.workspaceId, workspaceId)).for('update');
      const w = wRows[0];
      if (!w) throw domainError(ERROR_CODES.NOT_FOUND, 'Wallet not found', 404);

      const resRows = await tx
        .select({
          reserved: creditReservations.reservedCredits,
          captured: creditReservations.capturedCredits,
          released: creditReservations.releasedCredits,
        })
        .from(creditReservations)
        .where(eq(creditReservations.walletId, w.id));

      const expected = resRows.reduce(
        (sum, r) => sum + Math.max(0, r.reserved - r.captured - r.released),
        0,
      );
      const before = w.reservedBalance;
      if (before === expected) return { before, after: expected };

      await tx
        .update(wallets)
        .set({ reservedBalance: expected, updatedAt: new Date() })
        .where(eq(wallets.workspaceId, workspaceId));

      // 审计：记录校正前后 reserved 值（amount=0 表示本操作不改变可用余额）。
      await tx.insert(walletLedger).values({
        workspaceId,
        type: 'ADMIN_ADJUSTMENT',
        amount: 0,
        balanceBefore: w.balance,
        balanceAfter: w.balance,
        reservedBefore: before,
        reservedAfter: expected,
        idempotencyKey: `reconcile:${workspaceId}:${requestId}`,
        description: `Reservation invariant repair (reason=${reason})`,
      });

      return { before, after: expected };
    });
  }
}
