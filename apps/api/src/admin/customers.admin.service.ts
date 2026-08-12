import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq, sql } from 'drizzle-orm';
import { domainError, ERROR_CODES } from '@enova/contracts';
import {
  adminAuditLogs,
  costEvents,
  creditReservations,
  generationJobs,
  orders,
  paymentTransactions,
  plans,
  revenueEvents,
  sessions,
  subscriptions,
  usageEvents,
  users,
  walletLedger,
  wallets,
  workspaces,
  workspaceMembers,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export interface Customer360View {
  user: {
    id: string;
    email: string;
    role: string;
    status: string;
    createdAt: Date;
  };
  workspace: {
    id: string;
    name: string;
    type: string;
    role: string;
    createdAt: Date;
  } | null;
  wallet: {
    balance: number;
    reservedBalance: number;
    updatedAt: Date;
  } | null;
  subscription: {
    id: string;
    planId: string;
    planName: string | null;
    status: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
  } | null;
  reservations: Array<{
    id: string;
    generationJobId: string;
    reservedCredits: number;
    capturedCredits: number;
    releasedCredits: number;
    status: string;
    createdAt: Date;
    settledAt: Date | null;
  }>;
  ledger: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string | null;
    createdAt: Date;
  }>;
  generationsSummary: {
    total: number;
    byStatus: Record<string, number>;
    totalEstimatedCostMicrousd: number;
    totalFinalCostMicrousd: number;
    totalCreditsCharged: number;
  };
  payments: Array<{
    orderId: string;
    orderType: string;
    amountCents: number;
    currency: string;
    status: string;
    fulfillmentStatus: string;
    provider: string | null;
    providerRef: string | null;
    createdAt: Date;
  }>;
  recentGenerations: Array<{
    id: string;
    type: string;
    provider: string | null;
    model: string | null;
    status: string;
    estimatedCredits: number;
    createdAt: Date;
  }>;
  recentUsage: Array<{
    id: string;
    type: string;
    provider: string;
    model: string;
    estimatedCostMicrousd: number;
    finalCostMicrousd: number;
    costStatus: string;
    creditsCharged: number;
    createdAt: Date;
  }>;
  audit: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    createdAt: Date;
  }>;
  /** P1-7: 会话（运营/风控：数量、最近登录、IP、UA）。不含 token 明文。 */
  sessions: Array<{
    id: string;
    ip: string | null;
    userAgent: string | null;
    deviceName: string | null;
    lastSeenAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
    revoked: boolean;
  }>;
  /** P1-7: 当前 Plan Entitlement（限额 source of truth）。 */
  limits: {
    planId: string;
    planName: string | null;
    maxConcurrentGenerations: number;
    maxDurationSeconds: number;
    maxResolution: number;
    allowedResolutions: string[] | null;
    allowedModels: string[] | null;
    allowedGenerationTypes: string[] | null;
    dailyGenerationLimit: number | null;
    monthlyGenerationLimit: number | null;
    dailyCreditLimit: number | null;
    monthlyCreditLimit: number | null;
    rpm: number | null;
  } | null;
  /** P1-7: 成本事件汇总（按状态分布 + best available）。 */
  costs: {
    totalEstimatedCostMicrousd: number;
    totalReportedCostMicrousd: number;
    totalReconciledCostMicrousd: number;
    bestAvailableCostMicrousd: number;
    eventCount: number;
  };
  /** P1-7: 已确认收入（recognized revenue）。 */
  revenueRecognizedCents: number;
}

/**
 * Customer 360 视图（Admin P0-8）。
 * 一次性聚合用户、工作区、钱包、订阅、reservation、ledger、generation、payment、usage、audit。
 * 用于运营快速定位客户问题（欠费、孤儿任务、未履约订单等）。
 */
@Injectable()
export class CustomersAdminService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getCustomer360(userId: string): Promise<Customer360View> {
    // user
    const userRows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) throw domainError(ERROR_CODES.NOT_FOUND, 'User not found', 404);

    // workspace membership
    const memberRows = await this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(workspaceMembers.createdAt)
      .limit(1);
    const membership = memberRows[0];

    let workspace: Customer360View['workspace'] = null;
    let wallet: Customer360View['wallet'] = null;
    let subscription: Customer360View['subscription'] = null;
    let reservations: Customer360View['reservations'] = [];
    let ledger: Customer360View['ledger'] = [];
    let generationsSummary: Customer360View['generationsSummary'] = {
      total: 0,
      byStatus: {},
      totalEstimatedCostMicrousd: 0,
      totalFinalCostMicrousd: 0,
      totalCreditsCharged: 0,
    };
    let payments: Customer360View['payments'] = [];
    let recentGenerations: Customer360View['recentGenerations'] = [];
    let recentUsage: Customer360View['recentUsage'] = [];

    if (membership) {
      const wsRows = await this.db.select().from(workspaces).where(eq(workspaces.id, membership.workspaceId)).limit(1);
      const ws = wsRows[0];
      if (ws) {
        workspace = {
          id: ws.id,
          name: ws.name,
          type: ws.type,
          role: membership.role,
          createdAt: ws.createdAt,
        };
      }

      // wallet
      const wRows = await this.db.select().from(wallets).where(eq(wallets.workspaceId, membership.workspaceId)).limit(1);
      const w = wRows[0];
      if (w) {
        wallet = {
          balance: w.balance,
          reservedBalance: w.reservedBalance,
          updatedAt: w.updatedAt,
        };
      }

      // subscription（取最新 ACTIVE）
      const subRows = await this.db
        .select({
          id: subscriptions.id,
          planId: subscriptions.planId,
          planName: plans.name,
          status: subscriptions.status,
          currentPeriodStart: subscriptions.currentPeriodStart,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.workspaceId, membership.workspaceId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      const sub = subRows[0];
      if (sub) {
        subscription = {
          id: sub.id,
          planId: sub.planId,
          planName: sub.planName,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
        };
      }

      // reservations
      reservations = await this.db
        .select({
          id: creditReservations.id,
          generationJobId: creditReservations.generationJobId,
          reservedCredits: creditReservations.reservedCredits,
          capturedCredits: creditReservations.capturedCredits,
          releasedCredits: creditReservations.releasedCredits,
          status: creditReservations.status,
          createdAt: creditReservations.createdAt,
          settledAt: creditReservations.settledAt,
        })
        .from(creditReservations)
        .where(eq(creditReservations.workspaceId, membership.workspaceId))
        .orderBy(desc(creditReservations.createdAt))
        .limit(20);

      // ledger
      ledger = await this.db
        .select({
          id: walletLedger.id,
          type: walletLedger.type,
          amount: walletLedger.amount,
          balanceAfter: walletLedger.balanceAfter,
          description: walletLedger.description,
          createdAt: walletLedger.createdAt,
        })
        .from(walletLedger)
        .where(eq(walletLedger.workspaceId, membership.workspaceId))
        .orderBy(desc(walletLedger.createdAt))
        .limit(20);

      // generations summary
      const genStatusRows = await this.db
        .select({ status: generationJobs.status, n: count() })
        .from(generationJobs)
        .where(eq(generationJobs.workspaceId, membership.workspaceId))
        .groupBy(generationJobs.status);
      const genAgg = await this.db
        .select({
          total: count(),
          totalEstimatedCostMicrousd: sql<number>`coalesce(sum(${generationJobs.estimatedCostMicrousd}), 0)`,
          totalFinalCostMicrousd: sql<number>`coalesce(sum(${generationJobs.finalCostMicrousd}), 0)`,
        })
        .from(generationJobs)
        .where(eq(generationJobs.workspaceId, membership.workspaceId));
      const usageAgg = await this.db
        .select({ totalCreditsCharged: sql<number>`coalesce(sum(${usageEvents.creditsCharged}), 0)` })
        .from(usageEvents)
        .where(eq(usageEvents.workspaceId, membership.workspaceId));
      generationsSummary = {
        total: genAgg[0]?.total ?? 0,
        byStatus: Object.fromEntries(genStatusRows.map((r) => [r.status, r.n])),
        totalEstimatedCostMicrousd: genAgg[0]?.totalEstimatedCostMicrousd ?? 0,
        totalFinalCostMicrousd: genAgg[0]?.totalFinalCostMicrousd ?? 0,
        totalCreditsCharged: usageAgg[0]?.totalCreditsCharged ?? 0,
      };

      // payments
      const orderRows = await this.db
        .select({
          orderId: orders.id,
          orderType: orders.orderType,
          amountCents: orders.amountCents,
          currency: orders.currency,
          status: orders.status,
          fulfillmentStatus: orders.fulfillmentStatus,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.workspaceId, membership.workspaceId))
        .orderBy(desc(orders.createdAt))
        .limit(20);
      if (orderRows.length > 0) {
        const txRows = await this.db
          .select({
            orderId: paymentTransactions.orderId,
            provider: paymentTransactions.provider,
            providerRef: paymentTransactions.providerRef,
          })
          .from(paymentTransactions)
          .where(
            eq(paymentTransactions.orderId, orderRows[0]!.orderId), // 简化：只取第一单的 tx（详情在 Orders 模块）
          )
          .limit(1);
        payments = orderRows.map((o) => ({
          orderId: o.orderId,
          orderType: o.orderType,
          amountCents: o.amountCents,
          currency: o.currency,
          status: o.status,
          fulfillmentStatus: o.fulfillmentStatus,
          provider: txRows[0]?.provider ?? null,
          providerRef: txRows[0]?.providerRef ?? null,
          createdAt: o.createdAt,
        }));
      }

      // recent generations
      recentGenerations = await this.db
        .select({
          id: generationJobs.id,
          type: generationJobs.type,
          provider: generationJobs.provider,
          model: generationJobs.model,
          status: generationJobs.status,
          estimatedCredits: generationJobs.estimatedCredits,
          createdAt: generationJobs.createdAt,
        })
        .from(generationJobs)
        .where(eq(generationJobs.workspaceId, membership.workspaceId))
        .orderBy(desc(generationJobs.createdAt))
        .limit(10);

      // recent usage
      recentUsage = await this.db
        .select({
          id: usageEvents.id,
          type: usageEvents.type,
          provider: usageEvents.provider,
          model: usageEvents.model,
          estimatedCostMicrousd: usageEvents.estimatedCostMicrousd,
          finalCostMicrousd: usageEvents.finalCostMicrousd,
          costStatus: usageEvents.costStatus,
          creditsCharged: usageEvents.creditsCharged,
          createdAt: usageEvents.createdAt,
        })
        .from(usageEvents)
        .where(eq(usageEvents.workspaceId, membership.workspaceId))
        .orderBy(desc(usageEvents.createdAt))
        .limit(10);
    }

    // audit（user 维度：actor 是该 user 的记录）
    const auditRows = await this.db
      .select({
        id: adminAuditLogs.id,
        action: adminAuditLogs.action,
        resourceType: adminAuditLogs.resourceType,
        resourceId: adminAuditLogs.resourceId,
        createdAt: adminAuditLogs.createdAt,
      })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.actorUserId, userId))
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(10);

    // P1-7: 会话（user 维度，数量/最近登录/IP/UA，不含 token）
    const sessionRows = await this.db
      .select({
        id: sessions.id,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        deviceName: sessions.deviceName,
        lastSeenAt: sessions.lastSeenAt,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.lastSeenAt))
      .limit(20);
    const now = Date.now();
    const sessionsView = sessionRows.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      deviceName: s.deviceName,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      revoked: !!s.revokedAt || s.expiresAt.getTime() < now,
    }));

    // P1-7: 当前 Plan Entitlement（限额 source of truth）
    let limits: Customer360View['limits'] = null;
    if (subscription) {
      const planRows = await this.db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1);
      const p = planRows[0];
      if (p) {
        limits = {
          planId: p.id,
          planName: p.name,
          maxConcurrentGenerations: p.maxConcurrentGenerations,
          maxDurationSeconds: p.maxDurationSeconds,
          maxResolution: p.maxResolution,
          allowedResolutions: p.allowedResolutions ?? null,
          allowedModels: p.allowedModels ?? null,
          allowedGenerationTypes: p.allowedGenerationTypes ?? null,
          dailyGenerationLimit: p.dailyGenerationLimit,
          monthlyGenerationLimit: p.monthlyGenerationLimit,
          dailyCreditLimit: p.dailyCreditLimit,
          monthlyCreditLimit: p.monthlyCreditLimit,
          rpm: p.rpm,
        };
      }
    }

    // P1-7: 成本事件汇总（workspace 维度）
    const costRows = membership
      ? await this.db
          .select({
            status: costEvents.status,
            total: sql<number>`coalesce(sum(${costEvents.totalCostMicrousd}), 0)`,
            n: count(),
          })
          .from(costEvents)
          .where(eq(costEvents.workspaceId, membership.workspaceId))
          .groupBy(costEvents.status)
      : [];
    const costByStatus = new Map(costRows.map((r) => [r.status, r]));
    const costs = {
      totalEstimatedCostMicrousd: Number(costByStatus.get('ESTIMATED')?.total ?? 0),
      totalReportedCostMicrousd: Number(costByStatus.get('REPORTED')?.total ?? 0),
      totalReconciledCostMicrousd: Number(costByStatus.get('RECONCILED')?.total ?? 0),
      bestAvailableCostMicrousd:
        Number(costByStatus.get('RECONCILED')?.total ?? 0) ||
        Number(costByStatus.get('REPORTED')?.total ?? 0) ||
        Number(costByStatus.get('ESTIMATED')?.total ?? 0),
      eventCount: costRows.reduce((s, r) => s + r.n, 0),
    };

    // P1-7: 已确认收入（workspace 维度）
    const [revAgg] = membership
      ? await this.db
          .select({ n: sql<number>`coalesce(sum(${revenueEvents.recognizedAmountCents}), 0)` })
          .from(revenueEvents)
          .where(eq(revenueEvents.workspaceId, membership.workspaceId))
      : [{ n: 0 }];
    const revenueRecognizedCents = Number(revAgg?.n ?? 0);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      },
      workspace,
      wallet,
      subscription,
      reservations,
      ledger,
      generationsSummary,
      payments,
      recentGenerations,
      recentUsage,
      audit: auditRows,
      sessions: sessionsView,
      limits,
      costs,
      revenueRecognizedCents,
    };
  }
}
