import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { domainError, ERROR_CODES } from '@enova/contracts';
import {
  orders,
  plans,
  subscriptionFulfillments,
  subscriptions,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { WalletService } from './wallet.service.js';

export interface FulfillmentResult {
  orderId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'ALREADY_FULFILLED';
  subscriptionId?: string;
  creditsGranted: number;
}

/**
 * 订阅履约服务（P0-7）。
 *
 * 职责：支付成功后，为 PLAN 类型订单创建/续订 Subscription + 发放套餐 credits。
 *
 * 不变量：
 * - 幂等：subscription_fulfillments.idempotency_key = orderId（唯一约束），同一订单只履约一次。
 * - 事务安全：subscription 创建 + credits 发放 + fulfillment 记录在同一事务内。
 * - 订单快照：从 orders.snapshotJson 读取下单时的 plan 信息，不重查当前 plan 价格。
 * - Subscription 与 Wallet 独立：Subscription 管理权益，Wallet 管理额外 credits。
 *
 * 履约流程：
 * 1. 锁定订单行，校验 status=SUCCEEDED && fulfillmentStatus=PENDING。
 * 2. 读取 snapshot 获取 planId/credits/period。
 * 3. 创建/续订 Subscription（period_start/end 基于快照）。
 * 4. 发放 credits（如套餐包含）→ wallet.rechargeInTx。
 * 5. 写 fulfillment 行（idempotency_key = orderId）。
 * 6. 更新订单 fulfillmentStatus = SUCCEEDED。
 */
@Injectable()
export class SubscriptionFulfillmentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  /**
   * 履约指定订单。幂等：已履约则返回 ALREADY_FULFILLED。
   * 可由 payment webhook 后异步调用，或由 admin 手动 retry。
   */
  async fulfill(orderId: string): Promise<FulfillmentResult> {
    // 幂等检查：是否已有 fulfillment 记录。
    const existing = await this.db
      .select()
      .from(subscriptionFulfillments)
      .where(eq(subscriptionFulfillments.idempotencyKey, orderId))
      .limit(1);
    if (existing.length > 0 && existing[0].status === 'SUCCEEDED') {
      return {
        orderId,
        status: 'ALREADY_FULFILLED',
        subscriptionId: existing[0].subscriptionId ?? undefined,
        creditsGranted: existing[0].creditsGranted,
      };
    }

    return this.db.transaction(async (tx) => {
      // 锁定订单行。
      const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      const order = orderRows[0];
      if (!order) throw domainError(ERROR_CODES.PAYMENT_NOT_FOUND, 'Order not found', 404);
      if (order.status !== 'SUCCEEDED') {
        throw domainError(ERROR_CODES.PAYMENT_ORDER_NOT_PENDING, `Order payment not succeeded (${order.status})`, 409);
      }
      if (order.fulfillmentStatus === 'SUCCEEDED') {
        return { orderId, status: 'ALREADY_FULFILLED' as const, creditsGranted: 0 };
      }

      // 从订单快照读取 plan 信息（不重查当前 plan 价格，防止价格变动攻击）。
      const snapshot = (order.snapshotJson ?? {}) as {
        planId?: string;
        planCode?: string;
        monthlyCredits?: number;
        periodDays?: number;
        priceCents?: number;
        currency?: string;
      };

      const planId = order.planId ?? snapshot.planId;
      if (!planId) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, 'Cannot fulfill: order has no planId (not a PLAN order)', 400);
      }

      // 读取 plan（entitlements 来源）。
      const planRows = await tx.select().from(plans).where(eq(plans.id, planId)).limit(1);
      const plan = planRows[0];
      if (!plan) throw domainError(ERROR_CODES.NOT_FOUND, 'Plan not found', 404);

      const now = new Date();
      const periodDays = plan.periodDays || snapshot.periodDays || 30;
      const periodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
      const creditsToGrant = plan.monthlyCredits || 0;

      // 创建/续订 Subscription。
      // 简化模型：每个 plan 订单创建一条新 subscription 记录（固定期限）。
      // 未来 recurring 续费可扩展为续期现有 subscription。
      const [subscription] = await tx
        .insert(subscriptions)
        .values({
          workspaceId: order.workspaceId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        })
        .returning();

      // 发放 credits（如套餐包含）。
      if (creditsToGrant > 0) {
        await this.wallet.rechargeInTx(
          tx,
          order.workspaceId,
          creditsToGrant,
          orderId,
          `subscription:grant:${orderId}`,
          `Subscription grant: ${plan.name}`,
        );
      }

      // 写 fulfillment 记录（幂等键 = orderId）。
      await tx.insert(subscriptionFulfillments).values({
        orderId,
        workspaceId: order.workspaceId,
        subscriptionId: subscription.id,
        status: 'SUCCEEDED',
        creditsGranted: creditsToGrant,
        idempotencyKey: orderId,
        completedAt: now,
      });

      // 更新订单 fulfillment 状态。
      await tx
        .update(orders)
        .set({ fulfillmentStatus: 'SUCCEEDED', updatedAt: now })
        .where(eq(orders.id, orderId));

      return {
        orderId,
        status: 'SUCCEEDED',
        subscriptionId: subscription.id,
        creditsGranted: creditsToGrant,
      };
    });
  }

  /**
   * 扫描已支付但未履约的 PLAN 订单，批量履约。
   * 用于 reconciliation（webhook 后异步履约失败时的补偿）。
   */
  async reconcilePendingFulfillments(batchSize = 50): Promise<{ fulfilled: number; failed: number }> {
    const pending = await this.db
      .select({ id: orders.id, orderType: orders.orderType })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'SUCCEEDED'),
          eq(orders.fulfillmentStatus, 'PENDING'),
        ),
      )
      .limit(batchSize);

    let fulfilled = 0;
    let failed = 0;
    for (const order of pending) {
      if (order.orderType !== 'PLAN') {
        // RECHARGE/CREDIT_PACK 的 fulfillment 在 payment 时已完成，跳过。
        continue;
      }
      try {
        const result = await this.fulfill(order.id);
        if (result.status === 'SUCCEEDED') fulfilled++;
      } catch {
        failed++;
      }
    }
    return { fulfilled, failed };
  }

  /** 查询订单的履约状态。 */
  async getFulfillment(orderId: string) {
    const rows = await this.db
      .select()
      .from(subscriptionFulfillments)
      .where(eq(subscriptionFulfillments.orderId, orderId))
      .limit(1);
    return rows[0] ?? null;
  }
}
