import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import {
  assets,
  costEvents,
  creditReservations,
  generationJobs,
  orders,
  revenueEvents,
  users,
  type Database,
} from '@enova/db';
import { DEFAULT_FX_MICROUSD_PER_CENT } from './cost-revenue.js';

/** 时间窗口表达式：from/to 为闭区间起点（含）到开区间终点（不含）。 */
export interface AnalyticsWindow {
  startAt: Date;
  endAt: Date;
  /** IANA 时区 id，用于可解释的窗口标注（如 Asia/Shanghai）。 */
  timezone: string;
}

/** 快捷窗口。 */
export type AnalyticsRange = '24h' | '7d' | '30d' | 'custom';

/** 成本数据质量（事件数分布）。 */
export interface CostQuality {
  reconciled: number;
  reported: number;
  estimated: number;
  total: number;
  /** reconciled 占比百分比（0-100）。 */
  reconciledPercent: number;
}

/** P1-3 单一时间窗口的运营看板聚合。 */
export interface AnalyticsDashboard {
  window: {
    startAt: string;
    endAt: string;
    timezone: string;
    range: AnalyticsRange;
  };
  /** 计算时间（可重算标识水印）。 */
  calculatedAt: string;
  product: {
    totalUsers: number;
    newUsers: number;
    activeUsers: number;
    activeWorkspaces: number;
    jobs: number;
    successRate: number | null;
    failureRate: number | null;
    avgGenerationDurationMs: number | null;
  };
  usage: {
    creditsCaptured: number;
    videoSeconds: number;
    jobsByModel: Array<{ model: string; count: number }>;
    jobsByProvider: Array<{ provider: string; count: number }>;
    jobsByType: Array<{ type: string; count: number }>;
  };
  business: {
    ordersPaid: number;
    recognizedRevenueCents: number;
    cogsMicrousd: number;
    grossMarginPercent: number | null;
    arpuCents: number | null;
    revenuePerActiveUserCents: number | null;
    costPerVideoMicrousd: number | null;
  };
  costQuality: CostQuality;
}

/**
 * P1-3: Usage & Business Analytics domain service（纯 Node，非 NestJS）。
 *
 * 设计：
 * - 基于 PostgreSQL 实时聚合（当前数据量足够，不引入数据仓库）。
 * - 每个窗口都带上 window/timezone/calculatedAt 元信息，保证指标可解释、可重算。
 * - 收入/COGS 复用 CostRevenueLedger 的语义（RECONCILED > REPORTED > ESTIMATED）。
 * - 不伪造"看起来很精确"的成本：COGS 用 best available，costQuality 暴露数据可信度。
 */
export class BusinessAnalytics {
  constructor(private readonly db: Database) {}

  async dashboard(
    range: AnalyticsRange,
    opts: { timezone?: string; startAt?: Date; endAt?: Date } = {},
  ): Promise<AnalyticsDashboard> {
    const timezone = opts.timezone ?? 'UTC';
    const { startAt, endAt } = this.resolveWindow(range, opts);
    const calculatedAt = new Date();

    const [product, usage, business, costQuality] = await Promise.all([
      this.productMetrics(startAt, endAt),
      this.usageMetrics(startAt, endAt),
      this.businessMetrics(startAt, endAt),
      this.costQuality(startAt, endAt),
    ]);

    return {
      window: {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        timezone,
        range,
      },
      calculatedAt: calculatedAt.toISOString(),
      product,
      usage,
      business,
      costQuality,
    };
  }

  /** 导出 CSV：把看板拍平成行（便于运营二次处理）。 */
  async toCsv(range: AnalyticsRange, opts: { timezone?: string; startAt?: Date; endAt?: Date } = {}): Promise<string> {
    const d = await this.dashboard(range, opts);
    const rows: string[][] = [
      ['section', 'metric', 'value'],
      ['product.totalUsers', '', String(d.product.totalUsers)],
      ['product.newUsers', '', String(d.product.newUsers)],
      ['product.activeUsers', '', String(d.product.activeUsers)],
      ['product.activeWorkspaces', '', String(d.product.activeWorkspaces)],
      ['product.jobs', '', String(d.product.jobs)],
      ['product.successRate', '%', d.product.successRate === null ? '' : String(d.product.successRate)],
      ['product.avgGenerationDurationMs', '', d.product.avgGenerationDurationMs === null ? '' : String(d.product.avgGenerationDurationMs)],
      ['usage.creditsCaptured', '', String(d.usage.creditsCaptured)],
      ['usage.videoSeconds', '', String(d.usage.videoSeconds)],
      ['business.ordersPaid', '', String(d.business.ordersPaid)],
      ['business.recognizedRevenueCents', '', String(d.business.recognizedRevenueCents)],
      ['business.cogsMicrousd', '', String(d.business.cogsMicrousd)],
      ['business.grossMarginPercent', '%', d.business.grossMarginPercent === null ? '' : String(d.business.grossMarginPercent)],
      ['costQuality.reconciled', '', String(d.costQuality.reconciled)],
      ['costQuality.reported', '', String(d.costQuality.reported)],
      ['costQuality.estimated', '', String(d.costQuality.estimated)],
    ];
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        if (row[i].includes(',') || row[i].includes('"') || row[i].includes('\n')) {
          row[i] = `"${row[i].replace(/"/g, '""')}"`;
        }
      }
    }
    return rows.map((r) => r.join(',')).join('\n');
  }

  // ---- Product ----

  private async productMetrics(startAt: Date, endAt: Date): Promise<AnalyticsDashboard['product']> {
    const [totalUsers] = await this.db.select({ n: count() }).from(users);
    const [newUsers] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(gte(users.createdAt, startAt), lt(users.createdAt, endAt)));

    // 活跃用户/工作区：窗口内有生成任务
    const activeUsersRows = await this.db
      .select({ n: sql<number>`count(distinct ${generationJobs.userId})` })
      .from(generationJobs)
      .where(and(gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)));
    const activeWorkspacesRows = await this.db
      .select({ n: sql<number>`count(distinct ${generationJobs.workspaceId})` })
      .from(generationJobs)
      .where(and(gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)));

    const [jobsAgg] = await this.db
      .select({
        total: count(),
        succeeded: sql<number>`coalesce(sum(case when ${generationJobs.status} = 'SUCCEEDED' then 1 else 0 end), 0)`,
        failedT: sql<number>`coalesce(sum(case when ${generationJobs.status} in ('FAILED','CANCELED') then 1 else 0 end), 0)`,
        avgDur: sql<number | null>`avg(extract(epoch from (${generationJobs.completedAt} - ${generationJobs.startedAt})) * 1000)`,
      })
      .from(generationJobs)
      .where(and(gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)));

    const total = jobsAgg?.total ?? 0;
    const succeeded = Number(jobsAgg?.succeeded ?? 0);
    const failedT = Number(jobsAgg?.failedT ?? 0);

    return {
      totalUsers: totalUsers.n,
      newUsers: newUsers.n,
      activeUsers: activeUsersRows[0]?.n ?? 0,
      activeWorkspaces: activeWorkspacesRows[0]?.n ?? 0,
      jobs: total,
      successRate: total > 0 ? (succeeded / total) * 100 : null,
      failureRate: total > 0 ? (failedT / total) * 100 : null,
      avgGenerationDurationMs: jobsAgg?.avgDur == null ? null : Number(jobsAgg.avgDur),
    };
  }

  // ---- Usage ----

  private async usageMetrics(startAt: Date, endAt: Date): Promise<AnalyticsDashboard['usage']> {
    const [credits] = await this.db
      .select({ n: sql<number>`coalesce(sum(${creditReservations.capturedCredits}), 0)` })
      .from(creditReservations)
      .where(and(gte(creditReservations.createdAt, startAt), lt(creditReservations.createdAt, endAt)));

    const [videoSec] = await this.db
      .select({ n: sql<number>`coalesce(sum(${assets.duration}), 0)` })
      .from(assets)
      .innerJoin(generationJobs, eq(assets.generationJobId, generationJobs.id))
      .where(and(eq(assets.type, 'VIDEO'), eq(generationJobs.status, 'SUCCEEDED')));

    const jobsByModel = await this.db
      .select({ model: generationJobs.model, count: count() })
      .from(generationJobs)
      .where(and(gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)))
      .groupBy(generationJobs.model)
      .orderBy(sql`count desc`)
      .limit(50);
    const jobsByProvider = await this.db
      .select({ provider: generationJobs.provider, count: count() })
      .from(generationJobs)
      .where(and(gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)))
      .groupBy(generationJobs.provider)
      .orderBy(sql`count desc`)
      .limit(50);
    const jobsByType = await this.db
      .select({ type: generationJobs.type, count: count() })
      .from(generationJobs)
      .where(and(gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)))
      .groupBy(generationJobs.type)
      .orderBy(sql`count desc`)
      .limit(50);

    return {
      creditsCaptured: Number(credits?.n ?? 0),
      videoSeconds: Number(videoSec?.n ?? 0),
      jobsByModel: jobsByModel.map((r) => ({ model: r.model ?? '', count: r.count })),
      jobsByProvider: jobsByProvider.map((r) => ({ provider: r.provider ?? '', count: r.count })),
      jobsByType: jobsByType.map((r) => ({ type: r.type, count: r.count })),
    };
  }

  // ---- Business ----

  private async businessMetrics(startAt: Date, endAt: Date): Promise<AnalyticsDashboard['business']> {
    const [ordersPaidAgg] = await this.db
      .select({ n: count() })
      .from(orders)
      .where(and(eq(orders.status, 'SUCCEEDED'), gte(orders.createdAt, startAt), lt(orders.createdAt, endAt)));

    // 收入/COGS：复用 cost/revenue events（append-only ledger）
    const [rev] = await this.db
      .select({ n: sql<number>`coalesce(sum(${revenueEvents.recognizedAmountCents}), 0)` })
      .from(revenueEvents)
      .where(and(gte(revenueEvents.recognizedAt, startAt), lt(revenueEvents.recognizedAt, endAt)));
    const recognizedRevenueCents = Number(rev?.n ?? 0);

    const cogsMicrousd = await this.bestAvailableCogs(startAt, endAt);

    const grossMarginPercent =
      recognizedRevenueCents > 0
        ? ((recognizedRevenueCents * DEFAULT_FX_MICROUSD_PER_CENT - cogsMicrousd) /
            (recognizedRevenueCents * DEFAULT_FX_MICROUSD_PER_CENT)) *
          100
        : null;

    const [totalUsers] = await this.db.select({ n: count() }).from(users);
    const arpuCents = totalUsers.n > 0 ? recognizedRevenueCents / totalUsers.n : null;

    const [activeUsers] = await this.db
      .select({ n: sql<number>`count(distinct ${generationJobs.userId})` })
      .from(generationJobs)
      .where(and(gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)));
    const revenuePerActiveUserCents = activeUsers.n > 0 ? recognizedRevenueCents / activeUsers.n : null;

    const [videoJobs] = await this.db
      .select({ n: count() })
      .from(generationJobs)
      .where(and(eq(generationJobs.type, 'VIDEO'), eq(generationJobs.status, 'SUCCEEDED'), gte(generationJobs.createdAt, startAt), lt(generationJobs.createdAt, endAt)));
    const costPerVideoMicrousd = videoJobs.n > 0 ? cogsMicrousd / videoJobs.n : null;

    return {
      ordersPaid: ordersPaidAgg?.n ?? 0,
      recognizedRevenueCents,
      cogsMicrousd,
      grossMarginPercent,
      arpuCents,
      revenuePerActiveUserCents,
      costPerVideoMicrousd,
    };
  }

  /** 窗口内 best available COGS：同一成本事实按最高优先级计一次（RECONCILED > REPORTED > ESTIMATED）。 */
  private async bestAvailableCogs(startAt: Date, endAt: Date): Promise<number> {
    const rows = await this.db.execute<{ total_cost_microusd: number }>(sql`
      SELECT COALESCE(SUM(d.total_cost_microusd), 0) AS total_cost_microusd
      FROM (
        SELECT DISTINCT ON (generation_job_id, generation_attempt_id, cost_type, provider, model)
          total_cost_microusd
        FROM cost_events
        WHERE occurred_at >= ${startAt} AND occurred_at < ${endAt}
        ORDER BY
          generation_job_id, generation_attempt_id, cost_type, provider, model,
          CASE status WHEN 'RECONCILED' THEN 3 WHEN 'REPORTED' THEN 2 ELSE 1 END DESC
      ) d
    `);
    return Number(rows.rows?.[0]?.total_cost_microusd ?? 0);
  }

  private async costQuality(startAt: Date, endAt: Date): Promise<CostQuality> {
    const rows = await this.db
      .select({ status: costEvents.status, n: count() })
      .from(costEvents)
      .where(and(gte(costEvents.occurredAt, startAt), lt(costEvents.occurredAt, endAt)))
      .groupBy(costEvents.status);
    const map = new Map(rows.map((r) => [r.status, r.n]));
    const reconciled = map.get('RECONCILED') ?? 0;
    const reported = map.get('REPORTED') ?? 0;
    const estimated = map.get('ESTIMATED') ?? 0;
    const total = reconciled + reported + estimated;
    return {
      reconciled,
      reported,
      estimated,
      total,
      reconciledPercent: total > 0 ? (reconciled / total) * 100 : 0,
    };
  }

  private resolveWindow(range: AnalyticsRange, opts: { startAt?: Date; endAt?: Date }): { startAt: Date; endAt: Date } {
    const endAt = opts.endAt ?? new Date();
    let startAt: Date;
    if (range === 'custom' && opts.startAt) {
      startAt = opts.startAt;
    } else {
      const ms: Record<Exclude<AnalyticsRange, 'custom'>, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      };
      startAt = new Date(endAt.getTime() - ms[range as Exclude<AnalyticsRange, 'custom'>]);
    }
    return { startAt, endAt };
  }
}