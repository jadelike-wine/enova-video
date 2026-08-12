import { and, eq, sum, desc, count, between, sql, type SQL } from 'drizzle-orm';
import { type CostType, type RevenueType } from '@enova/contracts';
import {
  costEvents,
  revenueEvents,
  type Database,
} from '@enova/db';
import { type Tx } from './wallet.js';

/** 成本/收入状态（ESTIMATED / REPORTED / RECONCILED）。 */
export type CostStatus = (typeof costEvents.$inferSelect)['status'];
/** cost_events 行类型。 */
export type CostEvent = typeof costEvents.$inferSelect;
/** revenue_events 行类型。 */
export type RevenueEvent = typeof revenueEvents.$inferSelect;
/** 成本类型。 */
export type CostTypeKey = CostType;
/** 收入类型。 */
export type RevenueTypeKey = RevenueType;

/** 默认汇率：1 CNY 分 ≈ 14285 微美元（即 1 USD ≈ 7 CNY）。仅用于毛利率展示，业务层可覆盖。 */
export const DEFAULT_FX_MICROUSD_PER_CENT = 14285;

/** 成本查询参数。 */
export interface CostQuery {
  workspaceId?: string;
  userId?: string;
  generationJobId?: string;
  costType?: CostType;
  provider?: string;
  model?: string;
  startAt?: Date;
  endAt?: Date;
}

/** 收入查询参数。 */
export interface RevenueQuery {
  workspaceId?: string;
  userId?: string;
  orderId?: string;
  revenueType?: RevenueType;
  startAt?: Date;
  endAt?: Date;
}

/** 聚合结果：Gross Margin 计算。 */
export interface GrossMarginAgg {
  totalRecognizedRevenueCents: number;
  totalReconciledCostMicrousd: number;
  totalReportedCostMicrousd: number;
  totalEstimatedCostMicrousd: number;
  totalEvents: number;
  /** 按状态分布：{ ESTIMATED: count, REPORTED: count, RECONCILED: count } */
  costStatusDistribution: Record<CostStatus, number>;
  /**
   * 毛利率 = (Revenue - COGS) / Revenue。
   * Revenue 以微美元计（recognizedCents * fxMicrousdPerCent），COGS 以微美元计。
   * Revenue 为 0 时为 null。
   */
  grossMarginPercent: number | null;
  /** COGS 使用 RECONCILED 优先，缺失用 REPORTED，再缺失用 ESTIMATED。 */
  bestAvailableCOGSMicrousd: number;
  /** 汇率（微美元/CNY分），用于将 recognized revenue 换算为微美元。 */
  fxMicrousdPerCent: number;
}

/** 按 Provider 聚合。 */
export interface CostByProvider {
  provider: string;
  totalCostMicrousd: number;
  jobCount: number;
}

/** 按 Model 聚合。 */
export interface CostByModel {
  provider: string;
  model: string;
  totalCostMicrousd: number;
  jobCount: number;
}

/**
 * P1-1: Cost-Revenue LEDGER domain service.
 *
 * 职责：
 * - append-only 写入 cost_events / revenue_events（绝不 UPDATE 历史）
 * - 幂等写入（eventKey UNIQUE 约束）
 * - 聚合计算 gross margin（优先 RECONCILED → REPORTED → ESTIMATED）
 * - 提供按 provider/model/user/time 分组聚合
 *
 * 不变量：
 * - 同一 eventKey 只能插入一次；重复插入被幂等跳过（不抛错，返回已存在）
 * - 失败 job 仍保留已发生的 provider cost（因为 provider 已经 charge）
 * - RECONCILED > REPORTED > ESTIMATED 优先级用于 gross margin 计算
 */
export class CostRevenueLedger {
  /** 支持 Database 或事务 Tx（用于与支付/履约同事务写入，保证收入确认原子）。 */
  constructor(private readonly db: Database | Tx) {}

  // ---- COST: append-only write ----

  /** 插入一条成本事件（append-only，幂等）。如果 eventKey 已存在则跳过，不抛错。 */
  async insertCostEvent(params: {
    eventKey: string;
    workspaceId: string;
    userId: string;
    generationJobId?: string;
    generationAttemptId?: string | null;
    assetId?: string;
    costType: CostType;
    provider: string;
    model: string;
    quantity: number;
    unit?: string;
    unitCostMicrousd: number;
    totalCostMicrousd: number;
    status: CostStatus;
    externalBillingId?: string;
    occurredAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<{ inserted: boolean; event: CostEvent }> {
    // ON CONFLICT DO NOTHING：由 DB 唯一约束原子保证幂等，避免唯一冲突 abort 事务。
    const [event] = await this.db
      .insert(costEvents)
      .values({
        eventKey: params.eventKey,
        workspaceId: params.workspaceId,
        userId: params.userId,
        generationJobId: params.generationJobId,
        generationAttemptId: params.generationAttemptId,
        assetId: params.assetId,
        costType: params.costType,
        provider: params.provider,
        model: params.model,
        quantity: params.quantity,
        unit: params.unit,
        unitCostMicrousd: params.unitCostMicrousd,
        totalCostMicrousd: params.totalCostMicrousd,
        status: params.status,
        externalBillingId: params.externalBillingId,
        occurredAt: params.occurredAt ?? new Date(),
        metadataJson: params.metadata,
      })
      .onConflictDoNothing({ target: costEvents.eventKey })
      .returning();

    if (event) return { inserted: true, event };
    const existing = await this.db
      .select()
      .from(costEvents)
      .where(eq(costEvents.eventKey, params.eventKey))
      .limit(1);
    return { inserted: false, event: existing[0]! };
  }

  // ---- REVENUE: append-only write ----

  /** 插入一条收入确认事件（append-only，幂等由 eventKey UNIQUE 保证）。 */
  async insertRevenueEvent(params: {
    eventKey: string;
    workspaceId: string;
    userId: string;
    orderId?: string;
    generationJobId?: string;
    walletLedgerId?: string;
    revenueType: RevenueType;
    currency: string;
    grossAmountCents: number;
    refundAmountCents?: number;
    feeAmountCents?: number;
    recognizedAmountCents: number;
    recognizedAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<{ inserted: boolean; event: RevenueEvent }> {
    const [event] = await this.db
      .insert(revenueEvents)
      .values({
        eventKey: params.eventKey,
        workspaceId: params.workspaceId,
        userId: params.userId,
        orderId: params.orderId,
        generationJobId: params.generationJobId,
        walletLedgerId: params.walletLedgerId,
        revenueType: params.revenueType,
        currency: params.currency,
        grossAmountCents: params.grossAmountCents,
        refundAmountCents: params.refundAmountCents ?? 0,
        feeAmountCents: params.feeAmountCents ?? 0,
        recognizedAmountCents: params.recognizedAmountCents,
        recognizedAt: params.recognizedAt ?? new Date(),
        metadataJson: params.metadata,
      })
      .onConflictDoNothing({ target: revenueEvents.eventKey })
      .returning();

    if (event) return { inserted: true, event };
    const existing = await this.db
      .select()
      .from(revenueEvents)
      .where(eq(revenueEvents.eventKey, params.eventKey))
      .limit(1);
    return { inserted: false, event: existing[0]! };
  }

  // ---- Aggregation: Gross Margin ----

  /**
   * 计算 Gross Margin：
   * - Revenue: 求和 recognizedAmountCents
   * - Cost: 优先级 RECONCILED → REPORTED → ESTIMATED（同一事件只计一次最高优先级）
   * - Distribution: 按 cost status 统计事件数量，展示数据质量
   */
  async aggregateGrossMargin(query: CostQuery & RevenueQuery, fxMicrousdPerCent = DEFAULT_FX_MICROUSD_PER_CENT): Promise<GrossMarginAgg> {
    const conditions = this.buildCostConditions(query);

    // 先按状态分别求和，同时统计分布（反映数据质量，不用于 COGS 精确值）
    const result = await this.db
      .select({
        status: costEvents.status,
        totalCost: sum(costEvents.totalCostMicrousd),
        count: count(costEvents.id),
      })
      .from(costEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(costEvents.status);

    const totalRecognizedRevenue = await this.aggregateRecognizedRevenue(query);

    const distribution: Record<CostStatus, number> = {
      ESTIMATED: 0,
      REPORTED: 0,
      RECONCILED: 0,
    };

    let reconciled = 0;
    let reported = 0;
    let estimated = 0;
    let totalEvents = 0;

    for (const row of result) {
      const status = row.status as CostStatus;
      distribution[status] = Number(row.count ?? 0);
      totalEvents += Number(row.count ?? 0);
      const cost = Number(row.totalCost ?? 0);
      if (status === 'RECONCILED') reconciled = cost;
      else if (status === 'REPORTED') reported = cost;
      else if (status === 'ESTIMATED') estimated = cost;
    }

    // Best available COGS：同一成本事实（job + attempt + type + provider + model）只计一次最高优先级。
    // RECONCILED > REPORTED > ESTIMATED。不同 attempt 的成本都保留并聚合（不覆盖第一次 attempt）。
    const bestAvailable = await this.bestAvailableCOGS(conditions);

    // 毛利率（统一换算为微美元）
    const revenueMicrousd = totalRecognizedRevenue * fxMicrousdPerCent;
    let grossMarginPercent: number | null = null;
    if (revenueMicrousd > 0) {
      grossMarginPercent = ((revenueMicrousd - bestAvailable) / revenueMicrousd) * 100;
    }

    return {
      totalRecognizedRevenueCents: totalRecognizedRevenue,
      totalReconciledCostMicrousd: reconciled,
      totalReportedCostMicrousd: reported,
      totalEstimatedCostMicrousd: estimated,
      totalEvents,
      costStatusDistribution: distribution,
      grossMarginPercent,
      bestAvailableCOGSMicrousd: bestAvailable,
      fxMicrousdPerCent,
    };
  }

  /**
   * 计算 best available COGS（微美元）。
   * 每个成本事实按 (generation_job_id, generation_attempt_id, cost_type, provider, model) 分组，
   * 取优先级最高的一条（RECONCILED > REPORTED > ESTIMATED），再求和。
   * 这样同一 attempt 的 ESTIMATED/REPORTED/RECONCILED 不同阶段不会重复累加，
   * 而不同 attempt 的成本都会保留。
   */
  private async bestAvailableCOGS(conditions: Array<SQL>): Promise<number> {
    const whereClause = conditions.length > 0 ? sql`WHERE ${and(...conditions)}` : sql``;
    const rows = await this.db.execute<{ total_cost_microusd: number }>(sql`
      SELECT COALESCE(SUM(d.total_cost_microusd), 0) AS total_cost_microusd
      FROM (
        SELECT DISTINCT ON (
          generation_job_id, generation_attempt_id, cost_type, provider, model
        ) total_cost_microusd
        FROM cost_events
        ${whereClause}
        ORDER BY
          generation_job_id,
          generation_attempt_id,
          cost_type,
          provider,
          model,
          CASE status WHEN 'RECONCILED' THEN 3 WHEN 'REPORTED' THEN 2 ELSE 1 END DESC
      ) d
    `);
    return Number(rows.rows?.[0]?.total_cost_microusd ?? 0);
  }

  /** 求和已确认收入。 */
  async aggregateRecognizedRevenue(query: RevenueQuery): Promise<number> {
    const conditions = this.buildRevenueConditions(query);
    const [result] = await this.db
      .select({
        total: sum(revenueEvents.recognizedAmountCents),
      })
      .from(revenueEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return Number(result?.total ?? 0);
  }

  /** 按 Provider 聚合成本。 */
  async aggregateCostByProvider(query: CostQuery): Promise<CostByProvider[]> {
    const conditions = this.buildCostConditions(query);
    const result = await this.db
      .select({
        provider: costEvents.provider,
        totalCost: sum(costEvents.totalCostMicrousd),
        jobCount: count(costEvents.id),
      })
      .from(costEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(costEvents.provider)
      .orderBy(desc(sum(costEvents.totalCostMicrousd)));

    return result.map((r) => ({
      provider: r.provider,
      totalCostMicrousd: Number(r.totalCost ?? 0),
      jobCount: Number(r.jobCount ?? 0),
    }));
  }

  /** 按 Model 聚合成本。 */
  async aggregateCostByModel(query: CostQuery): Promise<CostByModel[]> {
    const conditions = this.buildCostConditions(query);
    const result = await this.db
      .select({
        provider: costEvents.provider,
        model: costEvents.model,
        totalCost: sum(costEvents.totalCostMicrousd),
        jobCount: count(costEvents.id),
      })
      .from(costEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(costEvents.provider, costEvents.model)
      .orderBy(desc(sum(costEvents.totalCostMicrousd)));

    return result.map((r) => ({
      provider: r.provider,
      model: r.model,
      totalCostMicrousd: Number(r.totalCost ?? 0),
      jobCount: Number(r.jobCount ?? 0),
    }));
  }

  /** 查询成本明细。 */
  async listCostEvents(query: CostQuery, limit = 50): Promise<CostEvent[]> {
    const conditions = this.buildCostConditions(query);
    const rows = await this.db
      .select()
      .from(costEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(costEvents.occurredAt))
      .limit(limit);
    return rows;
  }

  /** 查询收入明细。 */
  async listRevenueEvents(query: RevenueQuery, limit = 50): Promise<RevenueEvent[]> {
    const conditions = this.buildRevenueConditions(query);
    const rows = await this.db
      .select()
      .from(revenueEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(revenueEvents.recognizedAt))
      .limit(limit);
    return rows;
  }

  /** 对指定 generation job，获取 best available 总成本（RECONCILED > REPORTED > ESTIMATED）。 */
  async getBestCostForJob(generationJobId: string): Promise<{
    totalMicrousd: number;
    status: CostStatus;
    events: CostEvent[];
  }> {
    const events = await this.listCostEvents({ generationJobId }, 100);
    if (events.length === 0) {
      return { totalMicrousd: 0, status: 'ESTIMATED', events: [] };
    }

    // 找最高优先级
    const hasReconciled = events.some((e) => e.status === 'RECONCILED');
    const hasReported = events.some((e) => e.status === 'REPORTED');

    let targetStatus: CostStatus = 'ESTIMATED';
    if (hasReconciled) targetStatus = 'RECONCILED';
    else if (hasReported) targetStatus = 'REPORTED';

    const total = events
      .filter((e) => e.status === targetStatus)
      .reduce((sum, e) => sum + e.totalCostMicrousd, 0);

    return { totalMicrousd: total, status: targetStatus, events };
  }

  // ---- Helpers ----

  private buildCostConditions(query: CostQuery): Array<SQL> {
    const conds: SQL[] = [];
    if (query.workspaceId) conds.push(eq(costEvents.workspaceId, query.workspaceId));
    if (query.userId) conds.push(eq(costEvents.userId, query.userId));
    if (query.generationJobId) conds.push(eq(costEvents.generationJobId, query.generationJobId));
    if (query.costType) conds.push(eq(costEvents.costType, query.costType));
    if (query.provider) conds.push(eq(costEvents.provider, query.provider));
    if (query.model) conds.push(eq(costEvents.model, query.model));
    if (query.startAt && query.endAt) {
      conds.push(between(costEvents.occurredAt, query.startAt, query.endAt));
    }
    return conds;
  }

  private buildRevenueConditions(query: RevenueQuery): Array<SQL> {
    const conds: SQL[] = [];
    if (query.workspaceId) conds.push(eq(revenueEvents.workspaceId, query.workspaceId));
    if (query.userId) conds.push(eq(revenueEvents.userId, query.userId));
    if (query.orderId) conds.push(eq(revenueEvents.orderId, query.orderId));
    if (query.revenueType) conds.push(eq(revenueEvents.revenueType, query.revenueType));
    if (query.startAt && query.endAt) {
      conds.push(between(revenueEvents.recognizedAt, query.startAt, query.endAt));
    }
    return conds;
  }
}

/** 为 generation attempt 生成标准 eventKey。 */
export function generateCostEventKey(params: {
  generationJobId: string;
  attemptId: string;
  status: CostStatus;
}): string {
  return `genjob:${params.generationJobId}:attempt:${params.attemptId}:${params.status.toLowerCase()}`;
}

/** 为 order 生成标准 revenue eventKey。 */
export function generateRevenueEventKey(orderId: string): string {
  return `order:${orderId}:revenue`;
}
