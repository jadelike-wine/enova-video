import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, ne, type SQL } from 'drizzle-orm';
import { domainError, ERROR_CODES, type PaymentStatus } from '@enova/contracts';
import {
  orders,
  orderType,
  paymentTransactions,
  subscriptionFulfillments,
  subscriptions,
  manualRefundRecords,
  walletLedger,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { PaymentService } from '../payment/payment.service.js';
import { SubscriptionFulfillmentService } from '../billing/subscription-fulfillment.service.js';
import { WalletService } from '../billing/wallet.service.js';

export interface AdminOrderView {
  id: string;
  workspaceId: string;
  userId: string;
  orderType: string;
  amountCents: number;
  currency: string;
  credits: number;
  planId: string | null;
  status: string;
  fulfillmentStatus: string;
  snapshotJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminOrderDetailView extends AdminOrderView {
  paymentTransactions: Array<{
    id: string;
    provider: string;
    providerRef: string | null;
    status: string;
    refundAmountCents: number;
    refundStatus: string | null;
    refundedAt: Date | null;
  }>;
  fulfillment: {
    status: string | null;
    subscriptionId: string | null;
    creditsGranted: number;
    errorMessage: string | null;
    completedAt: Date | null;
  } | null;
  ledger: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string | null;
    createdAt: Date;
  }>;
  manualRefundRecords: Array<{
    id: string;
    status: string;
    reason: string;
    refundAmountCents: number;
    isFullRefund: boolean;
    channelRefundNo: string;
    refundChannel: string;
    creditsToRevoke: number;
    creditsRevoked: number;
    creditsFullyRevoked: boolean;
    operatorId: string;
    reviewNote: string | null;
    externalRefundedAt: Date | null;
    processedAt: Date | null;
    createdAt: Date;
  }>;
}

/**
 * 订单管理（Admin）。
 * 列表 / 详情 / 履约重试 / 取消 / 人工退款记录 / 异常订单查询。
 *
 * 人工退款业务规则（严格遵守）：
 * 1. 系统不提供自动退款，不调用支付宝/微信退款 API。
 * 2. 用户联系客服邮箱申请退款，客服在渠道商户后台人工退款。
 * 3. 管理员在后台记录处理结果（recordManualRefund），仅为内部登记和审计。
 * 4. 不改变 orders.status，不写入 legacy refund 字段。
 * 5. 对同一订单的人工处理幂等，并发请求不重复成功。
 * 6. Credits 余额不足时不静默完成，标记 creditsFullyRevoked=false。
 * 7. Plan 退款撤销订阅权益。
 */
@Injectable()
export class OrdersAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PaymentService) private readonly payment: PaymentService,
    @Inject(SubscriptionFulfillmentService) private readonly fulfillment: SubscriptionFulfillmentService,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async list(params: {
    limit?: number;
    offset?: number;
    status?: string;
    orderType?: string;
  }): Promise<AdminOrderView[]> {
    const limitSafe = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const offsetSafe = Math.max(params.offset ?? 0, 0);
    const conds: SQL[] = [];
    if (params.status) conds.push(eq(orders.status, params.status as PaymentStatus));
    if (params.orderType) conds.push(eq(orders.orderType, params.orderType as (typeof orderType.enumValues)[number]));
    const rows = await this.db
      .select()
      .from(orders)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(orders.createdAt))
      .limit(limitSafe)
      .offset(offsetSafe);
    return rows.map((r) => this.toView(r));
  }

  async detail(orderId: string): Promise<AdminOrderDetailView> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = orderRows[0];
    if (!order) throw domainError(ERROR_CODES.PAYMENT_NOT_FOUND, 'Order not found', 404);

    const txRows = await this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, orderId));
    const fulfillRows = await this.db
      .select()
      .from(subscriptionFulfillments)
      .where(eq(subscriptionFulfillments.orderId, orderId))
      .limit(1);
    const ledgerRows = await this.db
      .select({
        id: walletLedger.id,
        type: walletLedger.type,
        amount: walletLedger.amount,
        balanceAfter: walletLedger.balanceAfter,
        description: walletLedger.description,
        createdAt: walletLedger.createdAt,
      })
      .from(walletLedger)
      .where(eq(walletLedger.orderId, orderId))
      .orderBy(desc(walletLedger.createdAt));
    const refundRows = await this.db
      .select()
      .from(manualRefundRecords)
      .where(eq(manualRefundRecords.orderId, orderId))
      .orderBy(desc(manualRefundRecords.createdAt));

    return {
      ...this.toView(order),
      paymentTransactions: txRows.map((t) => ({
        id: t.id,
        provider: t.provider,
        providerRef: t.providerRef,
        status: t.status,
        refundAmountCents: t.refundAmountCents,
        refundStatus: t.refundStatus,
        refundedAt: t.refundedAt,
      })),
      fulfillment: fulfillRows[0]
        ? {
            status: fulfillRows[0].status,
            subscriptionId: fulfillRows[0].subscriptionId,
            creditsGranted: fulfillRows[0].creditsGranted,
            errorMessage: fulfillRows[0].errorMessage,
            completedAt: fulfillRows[0].completedAt,
          }
        : null,
      ledger: ledgerRows,
      manualRefundRecords: refundRows.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        refundAmountCents: r.refundAmountCents,
        isFullRefund: r.isFullRefund,
        channelRefundNo: r.channelRefundNo,
        refundChannel: r.refundChannel,
        creditsToRevoke: r.creditsToRevoke,
        creditsRevoked: r.creditsRevoked,
        creditsFullyRevoked: r.creditsFullyRevoked,
        operatorId: r.operatorId,
        reviewNote: r.reviewNote,
        externalRefundedAt: r.externalRefundedAt,
        processedAt: r.processedAt,
        createdAt: r.createdAt,
      })),
    };
  }

  /** 重试履约（幂等，由 SubscriptionFulfillmentService 保证）。 */
  async retryFulfillment(orderId: string): Promise<{ status: string; subscriptionId?: string; creditsGranted: number }> {
    const result = await this.fulfillment.fulfill(orderId);
    return {
      status: result.status,
      subscriptionId: result.subscriptionId,
      creditsGranted: result.creditsGranted,
    };
  }

  /** 关闭未支付订单。 */
  async closeOrder(orderId: string): Promise<void> {
    await this.payment.closePayment(orderId);
  }

  /** 获取订单当前状态（供审计 before 使用）。 */
  async getStatus(orderId: string): Promise<{ status: string; fulfillmentStatus: string } | null> {
    const rows = await this.db
      .select({ status: orders.status, fulfillmentStatus: orders.fulfillmentStatus })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return rows[0] ?? null;
  }

  // ---- 人工退款记录流程 ----

  /**
   * 记录人工退款处理结果。
   *
   * **产品规则**：系统不提供自动退款，不调用支付宝/微信退款 API。
   * 管理员在渠道商户平台完成人工退款后，在此记录处理结果。
   * 此方法仅为内部登记和审计，不执行真实退款。
   *
   * **不改变** orders.status，**不写入** legacy refund 字段。
   *
   * 流程：
   * 1. 校验订单存在且状态为 SUCCEEDED
   * 2. 校验 refundChannel 为 ALIPAY/WECHAT，channelRefundNo 非空
   * 3. 校验无已存在的人工退款记录（幂等）
   * 4. 事务内：锁订单 → 创建退款记录 → Credits 冲正 → 撤销订阅（Plan）
   * 5. Credits 余额不足：状态标记为 CREDITS_PENDING，不更改为 COMPLETED
   * 6. Plan 全额退款：通过 subscriptionFulfillments.orderId 找到关联订阅并撤销
   */
  async recordManualRefund(orderId: string, opts: {
    operatorId: string;
    reason: string;
    refundChannel: string;
    channelRefundNo: string;
    refundAmountCents?: number;
    reviewNote?: string;
    externalRefundedAt: string;
  }): Promise<{
    recordId: string;
    orderId: string;
    status: string;
    refundAmountCents: number;
    isFullRefund: boolean;
    creditsToRevoke: number;
    creditsRevoked: number;
    creditsFullyRevoked: boolean;
    subscriptionCanceled: boolean;
  }> {
    // Validate refundChannel.
    if (opts.refundChannel !== 'ALIPAY' && opts.refundChannel !== 'WECHAT') {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'refundChannel must be ALIPAY or WECHAT', 400);
    }
    // Trim channelRefundNo and reject empty/whitespace-only strings.
    const channelRefundNo = opts.channelRefundNo?.trim() ?? '';
    if (!channelRefundNo) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'channelRefundNo is required and must not be empty or whitespace-only', 400);
    }

    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = orderRows[0];
    if (!order) throw domainError(ERROR_CODES.PAYMENT_NOT_FOUND, 'Order not found', 404);
    if (order.status !== 'SUCCEEDED') {
      throw domainError(
        ERROR_CODES.PAYMENT_REFUND_NOT_ALLOWED,
        `Cannot record manual refund for order in status ${order.status}`,
        409,
      );
    }

    // Check for existing non-REJECTED manual refund record (idempotency).
    const existing = await this.db
      .select({ id: manualRefundRecords.id, status: manualRefundRecords.status })
      .from(manualRefundRecords)
      .where(
        and(
          eq(manualRefundRecords.orderId, orderId),
          ne(manualRefundRecords.status, 'REJECTED'),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      if (existing[0].status === 'CREDITS_PENDING') {
        throw domainError(
          ERROR_CODES.MANUAL_REFUND_ALREADY_PROCESSED,
          'Manual refund already recorded but credits are pending. Use the credits-retry endpoint to complete credits revocation.',
          409,
        );
      }
      throw domainError(
        ERROR_CODES.MANUAL_REFUND_ALREADY_PROCESSED,
        `Manual refund already recorded for this order (status: ${existing[0].status})`,
        409,
      );
    }

    // Check for duplicate channelRefundNo.
    const existingByRefNo = await this.db
      .select({ id: manualRefundRecords.id })
      .from(manualRefundRecords)
      .where(eq(manualRefundRecords.channelRefundNo, channelRefundNo))
      .limit(1);
    if (existingByRefNo.length > 0) {
      throw domainError(
        ERROR_CODES.MANUAL_REFUND_ALREADY_PROCESSED,
        `channelRefundNo '${channelRefundNo}' already exists`,
        409,
      );
    }

    const refundAmount = opts.refundAmountCents ?? order.amountCents;
    if (refundAmount <= 0) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'Refund amount must be a positive integer', 400);
    }
    if (refundAmount > order.amountCents) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'Refund amount exceeds order amount', 400);
    }
    const isFullRefund = refundAmount === order.amountCents;

    // Calculate proportional credits to revoke.
    const creditsToRevoke = isFullRefund
      ? order.credits
      : Math.floor((refundAmount / order.amountCents) * order.credits);

    // Idempotency key for the REFUND ledger entry.
    const idempotencyKey = `manual-refund:${orderId}:${channelRefundNo}`;

    let creditsRevoked = 0;
    let creditsFullyRevoked = true;
    let subscriptionCanceled = false;
    let recordId = '';
    let finalStatus: 'COMPLETED' | 'CREDITS_PENDING' = 'COMPLETED';

    await this.db.transaction(async (tx) => {
      // Lock the order row for concurrent safety.
      const locked = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      const lockedOrder = locked[0];
      if (!lockedOrder || lockedOrder.status !== 'SUCCEEDED') return;

      // Re-check inside transaction for concurrent safety.
      const existingInTx = await tx
        .select({ id: manualRefundRecords.id })
        .from(manualRefundRecords)
        .where(
          and(
            eq(manualRefundRecords.orderId, orderId),
            ne(manualRefundRecords.status, 'REJECTED'),
          ),
        )
        .limit(1);
      if (existingInTx.length > 0) return;

      // Re-check channelRefundNo inside transaction.
      const existingRefNoInTx = await tx
        .select({ id: manualRefundRecords.id })
        .from(manualRefundRecords)
        .where(eq(manualRefundRecords.channelRefundNo, channelRefundNo))
        .limit(1);
      if (existingRefNoInTx.length > 0) return;

      // Revoke credits from wallet using REFUND ledger type.
      if (creditsToRevoke > 0) {
        try {
          await this.wallet.refundCreditsInTx(
            tx,
            order.workspaceId,
            creditsToRevoke,
            orderId,
            idempotencyKey,
            `Manual refund: ${opts.reason} (channel: ${opts.refundChannel}/${channelRefundNo})`,
          );
          creditsRevoked = creditsToRevoke;
        } catch (err) {
          const code = (err as Error & { code?: string }).code;
          if (code === ERROR_CODES.NEGATIVE_BALANCE) {
            // Credits insufficient — mark as CREDITS_PENDING, do NOT complete.
            creditsFullyRevoked = false;
            finalStatus = 'CREDITS_PENDING';
          } else {
            throw err; // Re-throw unexpected errors.
          }
        }
      }

      // For Plan orders with full refund, cancel the subscription
      // by finding it through subscriptionFulfillments.orderId (NOT by workspace).
      if (order.orderType === 'PLAN' && isFullRefund) {
        const fulfillRows = await tx
          .select({ subscriptionId: subscriptionFulfillments.subscriptionId })
          .from(subscriptionFulfillments)
          .where(eq(subscriptionFulfillments.orderId, orderId))
          .limit(1);

        const subscriptionId = fulfillRows[0]?.subscriptionId;
        if (subscriptionId) {
          // Only cancel if currently ACTIVE.
          const subRows = await tx
            .select({ id: subscriptions.id, status: subscriptions.status })
            .from(subscriptions)
            .where(eq(subscriptions.id, subscriptionId))
            .limit(1);
          if (subRows.length > 0 && subRows[0].status === 'ACTIVE') {
            await tx.update(subscriptions).set({
              status: 'CANCELED',
              updatedAt: new Date(),
            }).where(eq(subscriptions.id, subscriptionId));
            subscriptionCanceled = true;
          }
        }
      }

      // Create the manual refund record.
      // CREDITS_PENDING must NOT write processedAt — only COMPLETED does.
      const [inserted] = await tx.insert(manualRefundRecords).values({
        orderId,
        workspaceId: order.workspaceId,
        status: finalStatus,
        reason: opts.reason,
        refundAmountCents: refundAmount,
        isFullRefund,
        channelRefundNo: channelRefundNo,
        refundChannel: opts.refundChannel,
        creditsToRevoke,
        creditsRevoked,
        creditsFullyRevoked,
        operatorId: opts.operatorId,
        reviewNote: opts.reviewNote,
        externalRefundedAt: new Date(opts.externalRefundedAt),
        processedAt: finalStatus === 'COMPLETED' ? new Date() : null,
      }).returning({ id: manualRefundRecords.id });
      recordId = inserted.id;
    });

    if (!recordId) {
      // Transaction returned without creating record (concurrent duplicate).
      throw domainError(
        ERROR_CODES.MANUAL_REFUND_ALREADY_PROCESSED,
        'Manual refund already recorded for this order (concurrent)',
        409,
      );
    }

    return {
      recordId,
      orderId,
      status: finalStatus,
      refundAmountCents: refundAmount,
      isFullRefund,
      creditsToRevoke,
      creditsRevoked,
      creditsFullyRevoked,
      subscriptionCanceled,
    };
  }

  /**
   * 补扣 Credits：对 CREDITS_PENDING 状态的人工退款记录再次尝试冲正。
   *
   * **不**重新调用支付宝/微信，**不**重新创建现金退款记录，**不**重复取消订阅。
   *
   * - 只允许处理 CREDITS_PENDING 状态。
   * - 使用稳定幂等键 `manual-refund:${refundRecordId}:credits`。
   * - 钱包余额足够：写入负值 REFUND ledger → COMPLETED。
   * - 钱包余额不足：保持 CREDITS_PENDING，返回明确状态。
   * - 如果该幂等键的 REFUND ledger 已存在，识别为已完成。
   *
   * 并发安全：
   * - 事务内始终以加锁后的 lockedRecord 为准，不使用事务外读取的旧对象。
   * - 如果记录已被并发请求改为 COMPLETED，当前请求读取真实状态并返回 COMPLETED。
   * - 事务结束后重新读取当前 refund record，确保管理端响应反映最终数据库状态。
   */
  async retryCreditsRevocation(orderId: string, opts: { operatorId: string }): Promise<{
    recordId: string;
    orderId: string;
    status: string;
    creditsToRevoke: number;
    creditsRevoked: number;
    creditsFullyRevoked: boolean;
  }> {
    // Load the CREDITS_PENDING manual refund record for this order.
    // Filter by status = 'CREDITS_PENDING' with stable ordering to avoid picking
    // the wrong record when multiple refund records exist for the same order.
    const refundRows = await this.db
      .select()
      .from(manualRefundRecords)
      .where(
        and(
          eq(manualRefundRecords.orderId, orderId),
          eq(manualRefundRecords.status, 'CREDITS_PENDING'),
        ),
      )
      .orderBy(desc(manualRefundRecords.createdAt))
      .limit(1);
    const refundRecord = refundRows[0];
    if (!refundRecord) {
      // Check if a non-CREDITS_PENDING record exists to give a helpful error.
      const anyRecord = await this.db
        .select({ id: manualRefundRecords.id, status: manualRefundRecords.status })
        .from(manualRefundRecords)
        .where(eq(manualRefundRecords.orderId, orderId))
        .limit(1);
      if (!anyRecord[0]) {
        throw domainError(ERROR_CODES.NOT_FOUND, 'Manual refund record not found for this order', 404);
      }
      throw domainError(
        ERROR_CODES.VALIDATION_ERROR,
        `Cannot retry credits revocation for record in status ${anyRecord[0].status}. Only CREDITS_PENDING is retryable.`,
        409,
      );
    }

    const remainingCredits = refundRecord.creditsToRevoke - refundRecord.creditsRevoked;

    // Edge case: creditsToRevoke already fully revoked but status wasn't updated.
    if (remainingCredits <= 0) {
      await this.db
        .update(manualRefundRecords)
        .set({
          status: 'COMPLETED',
          creditsFullyRevoked: true,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manualRefundRecords.id, refundRecord.id));
      return {
        recordId: refundRecord.id,
        orderId,
        status: 'COMPLETED',
        creditsToRevoke: refundRecord.creditsToRevoke,
        creditsRevoked: refundRecord.creditsToRevoke,
        creditsFullyRevoked: true,
      };
    }

    // Stable idempotency key for the retry ledger.
    const idempotencyKey = `manual-refund:${refundRecord.id}:credits`;

    await this.db.transaction(async (tx) => {
      // Lock the refund record for concurrent safety.
      const locked = await tx
        .select()
        .from(manualRefundRecords)
        .where(eq(manualRefundRecords.id, refundRecord.id))
        .for('update');
      const lockedRecord = locked[0];

      // If the record was already completed by a concurrent retry, return without
      // doing anything. The post-transaction re-read will return the true COMPLETED state.
      if (!lockedRecord || lockedRecord.status !== 'CREDITS_PENDING') return;

      try {
        await this.wallet.refundCreditsInTx(
          tx,
          lockedRecord.workspaceId,
          remainingCredits,
          orderId,
          idempotencyKey,
          `Credits retry for manual refund ${lockedRecord.id} (by operator ${opts.operatorId})`,
        );

        // Use lockedRecord values (not the stale outer refundRecord) for the update.
        await tx
          .update(manualRefundRecords)
          .set({
            status: 'COMPLETED',
            creditsRevoked: lockedRecord.creditsToRevoke,
            creditsFullyRevoked: true,
            processedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(manualRefundRecords.id, lockedRecord.id));
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === ERROR_CODES.NEGATIVE_BALANCE) {
          // Still insufficient — keep CREDITS_PENDING, do NOT write negative balance.
          // The post-transaction re-read will return the true CREDITS_PENDING state.
          return;
        } else {
          throw err;
        }
      }
    });

    // Post-transaction re-read: always return the true final database state.
    // This ensures concurrent retries that lost the race still see COMPLETED
    // instead of returning stale CREDITS_PENDING from the pre-transaction read.
    const finalRows = await this.db
      .select()
      .from(manualRefundRecords)
      .where(eq(manualRefundRecords.id, refundRecord.id))
      .limit(1);
    const finalRecord = finalRows[0];

    return {
      recordId: refundRecord.id,
      orderId,
      status: finalRecord.status,
      creditsToRevoke: finalRecord.creditsToRevoke,
      creditsRevoked: finalRecord.creditsRevoked,
      creditsFullyRevoked: finalRecord.creditsFullyRevoked,
    };
  }

  /**
   * 异常订单查询：查找支付成功但履约失败、待处理超时等异常状态。
   * stalePending 使用明确的时间过滤（超过 1 小时的 PENDING 履约）。
   */
  async listAnomalies(): Promise<Array<{
    orderId: string;
    userId: string;
    orderType: string;
    status: string;
    fulfillmentStatus: string;
    amountCents: number;
    createdAt: Date;
    anomalyType: string;
  }>> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // 1. Payment succeeded but fulfillment failed
    const failedFulfillment = await this.db
      .select({
        orderId: orders.id,
        userId: orders.userId,
        orderType: orders.orderType,
        status: orders.status,
        fulfillmentStatus: orders.fulfillmentStatus,
        amountCents: orders.amountCents,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'SUCCEEDED'),
          eq(orders.fulfillmentStatus, 'FAILED'),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(50);

    // 2. Payment succeeded but fulfillment still pending for > 1 hour
    const stalePending = await this.db
      .select({
        orderId: orders.id,
        userId: orders.userId,
        orderType: orders.orderType,
        status: orders.status,
        fulfillmentStatus: orders.fulfillmentStatus,
        amountCents: orders.amountCents,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'SUCCEEDED'),
          eq(orders.fulfillmentStatus, 'PENDING'),
          lt(orders.updatedAt, oneHourAgo),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(50);

    return [
      ...failedFulfillment.map((r) => ({ ...r, anomalyType: 'FULFILLMENT_FAILED' })),
      ...stalePending.map((r) => ({ ...r, anomalyType: 'FULFILLMENT_STALE' })),
    ];
  }

  private toView(r: typeof orders.$inferSelect): AdminOrderView {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      userId: r.userId,
      orderType: r.orderType,
      amountCents: r.amountCents,
      currency: r.currency,
      credits: r.credits,
      planId: r.planId,
      status: r.status,
      fulfillmentStatus: r.fulfillmentStatus,
      snapshotJson: r.snapshotJson,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
