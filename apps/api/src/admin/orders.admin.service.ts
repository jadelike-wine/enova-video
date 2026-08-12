import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { domainError, ERROR_CODES, type PaymentStatus } from '@enova/contracts';
import {
  orders,
  orderType,
  paymentTransactions,
  subscriptionFulfillments,
  walletLedger,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { PaymentService } from '../payment/payment.service.js';
import { SubscriptionFulfillmentService } from '../billing/subscription-fulfillment.service.js';

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
}

/**
 * 订单管理（Admin P0-8）。
 * 列表 / 详情 / 履约重试 / 取消。
 * 产品策略：暂不支持任何自动退款，Admin 不提供退款操作（仅线下商户平台人工处理）。
 * 所有写操作由 controller 落审计日志。
 */
@Injectable()
export class OrdersAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PaymentService) private readonly payment: PaymentService,
    @Inject(SubscriptionFulfillmentService) private readonly fulfillment: SubscriptionFulfillmentService,
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
