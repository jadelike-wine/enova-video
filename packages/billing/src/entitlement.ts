import { and, eq, gte, sql, count, inArray } from 'drizzle-orm';
import { domainError, ERROR_CODES, type GenerationType, resolveVideoDurationFromInput, validateVideoFrames } from '@enova/contracts';
import {
  plans,
  subscriptions,
  generationJobs,
  creditReservations,
  type Database,
} from '@enova/db';

/** 用户的 Plan 权益（Entitlement）。 */
export interface Entitlement {
  planId: string;
  planCode: string;
  name: string;
  maxConcurrentGenerations: number;
  maxResolution: number;
  maxDurationSeconds: number;
  storageRetentionDays: number;
  priority: number;
  watermark: boolean;
  commercialUse: boolean;
  allowedModels: string[] | null; // 空 = 全部允许
  allowedGenerationTypes: string[] | null; // 空 = 全部允许
  allowedResolutions: string[] | null; // 空 = 全部允许
  dailyGenerationLimit: number | null;
  monthlyGenerationLimit: number | null;
  dailyCreditLimit: number | null;
  monthlyCreditLimit: number | null;
  rpm: number | null;
}

const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'] as const;

/**
 * P1-2: 用户级 Limits / Concurrency / Quota 领域服务。
 *
 * 把 Plan / Subscription / Workspace 的 Entitlement 作为 source of truth，
 * 在创建生成任务前做 concurrency-safe 的限制检查。
 *
 * 并发安全策略：
 * - 通过事务内对 subscription 行 `SELECT ... FOR UPDATE` 加锁，将同一 workspace
 *   的并发"创建任务"请求串行化，避免 `count(*)` 穿透。
 * - 在锁内统计 active jobs（QUEUED/RUNNING）与日/月配额用量。
 *
 * 不变量：
 * - 使用 Plan Entitlements 作为唯一限制来源，不把 worker concurrency / credential
 *   concurrency 当作用户商业限额。
 * - Overage 返回明确业务错误码（CONCURRENCY_LIMIT_REACHED 等），前端可展示。
 */
export class EntitlementService {
  constructor(private readonly db: Database) {}

  /** 解析用户当前生效的 Entitlement（默认取最早创建的 ACTIVE subscription）。 */
  async resolveEntitlement(workspaceId: string, now = new Date()): Promise<Entitlement | null> {
    const active = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, workspaceId),
          eq(subscriptions.status, 'ACTIVE'),
        ),
      )
      .orderBy(subscriptions.createdAt)
      .limit(1);

    if (active.length === 0) return null;
    const sub = active[0];
    if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < now.getTime()) return null; // 已过期

    const planRows = await this.db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
    if (planRows.length === 0) return null;
    return this.toEntitlement(planRows[0]);
  }

  /** 转 Entitlement 视图。 */
  toEntitlement(plan: typeof plans.$inferSelect): Entitlement {
    return {
      planId: plan.id,
      planCode: plan.code,
      name: plan.name,
      maxConcurrentGenerations: plan.maxConcurrentGenerations,
      maxResolution: plan.maxResolution,
      maxDurationSeconds: plan.maxDurationSeconds,
      storageRetentionDays: plan.storageRetentionDays,
      priority: plan.priority,
      watermark: plan.watermark,
      commercialUse: plan.commercialUse,
      allowedModels: plan.allowedModels ?? null,
      allowedGenerationTypes: plan.allowedGenerationTypes ?? null,
      allowedResolutions: plan.allowedResolutions ?? null,
      dailyGenerationLimit: plan.dailyGenerationLimit ?? null,
      monthlyGenerationLimit: plan.monthlyGenerationLimit ?? null,
      dailyCreditLimit: plan.dailyCreditLimit ?? null,
      monthlyCreditLimit: plan.monthlyCreditLimit ?? null,
      rpm: plan.rpm ?? null,
    };
  }

  /**
   * 创建任务前的授权检查：模型/类型/分辨率/时长 + 并发 + 日/月配额 + 日/月 credits。
   * 任一项不满足抛 DomainError（明确业务错误码），否则返回解析到的 Entitlement。
   *
   * 需要传入期望消耗的 credits（用于 credits 配额检查）。
   */
  async authorizeJob(params: {
    workspaceId: string;
    type: GenerationType;
    model: string;
    input: Record<string, unknown>;
    expectedCredits: number;
    now?: Date;
    /** true 时无有效订阅不报错，返回 null（允许默认行为，如免费 credits 生成）。默认 false。 */
    optional?: boolean;
  }): Promise<Entitlement | null> {
    const now = params.now ?? new Date();
    const entitlement = await this.resolveEntitlement(params.workspaceId, now);
    if (!entitlement) {
      if (params.optional) return null;
      throw domainError(
        ERROR_CODES.NO_ACTIVE_SUBSCRIPTION,
        'No active subscription or plan entitlement',
        403,
        { workspaceId: params.workspaceId },
      );
    }

    // ---- 静态校验：model / type / resolution / duration ----
    if (entitlement.allowedModels && entitlement.allowedModels.length > 0 && !entitlement.allowedModels.includes(params.model)) {
      throw domainError(ERROR_CODES.MODEL_NOT_ALLOWED, `Model '${params.model}' is not allowed on this plan`, 403, {
        allowed: entitlement.allowedModels,
      });
    }
    if (entitlement.allowedGenerationTypes && entitlement.allowedGenerationTypes.length > 0 && !entitlement.allowedGenerationTypes.includes(params.type)) {
      throw domainError(ERROR_CODES.GENERATION_TYPE_NOT_ALLOWED, `Generation type '${params.type}' is not allowed on this plan`, 403, {
        allowed: entitlement.allowedGenerationTypes,
      });
    }

    const resolution = this.resolveResolution(params.input);
    if (entitlement.allowedResolutions && entitlement.allowedResolutions.length > 0 && resolution) {
      const allowedNorm = entitlement.allowedResolutions.map((r) => String(r).toLowerCase());
      if (!allowedNorm.includes(resolution.toLowerCase())) {
        throw domainError(ERROR_CODES.RESOLUTION_NOT_ALLOWED, `Resolution '${resolution}' is not allowed on this plan`, 403, {
          allowed: entitlement.allowedResolutions,
        });
      }
    }
    if (entitlement.maxResolution > 0 && resolution) {
      const maxDim = Math.max(...resolution.split('x').map(Number).filter((n) => Number.isFinite(n)));
      if (maxDim > entitlement.maxResolution) {
        throw domainError(ERROR_CODES.RESOLUTION_NOT_ALLOWED, `Resolution '${resolution}' exceeds plan max ${entitlement.maxResolution}`, 403);
      }
    }

    const duration = this.resolveDuration(params.input);
    if (entitlement.maxDurationSeconds > 0 && duration && duration > entitlement.maxDurationSeconds) {
      throw domainError(ERROR_CODES.VIDEO_DURATION_EXCEEDED, `Video duration ${duration}s exceeds plan max ${entitlement.maxDurationSeconds}s`, 403);
    }

    // Video frames validation: numFrames/frameRate 必须在项目内部校验，不依赖上游。
    // 即使 UI 只允许合法值，服务端也不能信任客户端输入。
    if (params.type === 'VIDEO') {
      const nf = Number(params.input.numFrames);
      const fr = Number(params.input.frameRate);
      const frameErr = validateVideoFrames(nf, fr);
      if (frameErr) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, `Invalid video parameters: ${frameErr}`, 422);
      }
    }

    // ---- 并发 + 日/月配额 + credits 配额（concurrency-safe，事务内锁 subscription） ----
    await this.checkRunningAndQuotaInTx(params.workspaceId, entitlement, params.expectedCredits, now);

    return entitlement;
  }

  /**
   * 并发安全限额检查：在事务内锁 subscription 行，串行化同一 workspace 的创建。
   * 统计：active jobs（并发）、当日/当月 job 数、当日/当月已消耗 credits。
   */
  private async checkRunningAndQuotaInTx(
    workspaceId: string,
    entitlement: Entitlement,
    expectedCredits: number,
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 锁 subscription（串行化同一 workspace 的并发创建）
      await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.workspaceId, workspaceId),
            eq(subscriptions.status, 'ACTIVE'),
          ),
        )
        .for('update')
        .limit(1);

      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // 并发：active jobs
      const [activeRow] = await tx
        .select({ n: count() })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.workspaceId, workspaceId),
            inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES]),
          ),
        );
      const activeCount = Number(activeRow?.n ?? 0);
      if (activeCount >= entitlement.maxConcurrentGenerations) {
        throw domainError(ERROR_CODES.CONCURRENCY_LIMIT_REACHED, 'Concurrent generation limit reached', 429, {
          current: activeCount,
          max: entitlement.maxConcurrentGenerations,
        });
      }

      // 日配额
      if (entitlement.dailyGenerationLimit != null) {
        const [dRow] = await tx
          .select({ n: count() })
          .from(generationJobs)
          .where(and(eq(generationJobs.workspaceId, workspaceId), gte(generationJobs.createdAt, startOfDay)));
        if (Number(dRow?.n ?? 0) >= entitlement.dailyGenerationLimit) {
          throw domainError(ERROR_CODES.DAILY_QUOTA_EXCEEDED, 'Daily generation quota exceeded', 429, {
            limit: entitlement.dailyGenerationLimit,
          });
        }
      }

      // 月配额
      if (entitlement.monthlyGenerationLimit != null) {
        const [mRow] = await tx
          .select({ n: count() })
          .from(generationJobs)
          .where(and(eq(generationJobs.workspaceId, workspaceId), gte(generationJobs.createdAt, startOfMonth)));
        if (Number(mRow?.n ?? 0) >= entitlement.monthlyGenerationLimit) {
          throw domainError(ERROR_CODES.MONTHLY_QUOTA_EXCEEDED, 'Monthly generation quota exceeded', 429, {
            limit: entitlement.monthlyGenerationLimit,
          });
        }
      }

      // 日/月 credits 消耗（累加 reservation 的 captured+released 视为消耗）
      if (entitlement.dailyCreditLimit != null || entitlement.monthlyCreditLimit != null) {
        const [spent] = await tx
          .select({
            daily: sql<number>`coalesce(sum(${creditReservations.capturedCredits} + ${creditReservations.releasedCredits}), 0)`,
          })
          .from(creditReservations)
          .innerJoin(generationJobs, eq(creditReservations.generationJobId, generationJobs.id))
          .where(
            and(
              eq(generationJobs.workspaceId, workspaceId),
              gte(generationJobs.createdAt, startOfDay),
            ),
          );
        const dailySpent = Number(spent?.daily ?? 0);
        if (entitlement.dailyCreditLimit != null && dailySpent + expectedCredits > entitlement.dailyCreditLimit) {
          throw domainError(ERROR_CODES.DAILY_QUOTA_EXCEEDED, 'Daily credit limit exceeded', 429, {
            current: dailySpent,
            max: entitlement.dailyCreditLimit,
            need: expectedCredits,
          });
        }
      }

      // 月 credits 消耗
      if (entitlement.monthlyCreditLimit != null) {
        const [spentMonthly] = await tx
          .select({
            monthly: sql<number>`coalesce(sum(${creditReservations.capturedCredits} + ${creditReservations.releasedCredits}), 0)`,
          })
          .from(creditReservations)
          .innerJoin(generationJobs, eq(creditReservations.generationJobId, generationJobs.id))
          .where(
            and(
              eq(generationJobs.workspaceId, workspaceId),
              gte(generationJobs.createdAt, startOfMonth),
            ),
          );
        const monthlySpent = Number(spentMonthly?.monthly ?? 0);
        if (entitlement.monthlyCreditLimit != null && monthlySpent + expectedCredits > entitlement.monthlyCreditLimit) {
          throw domainError(ERROR_CODES.MONTHLY_QUOTA_EXCEEDED, 'Monthly credit limit exceeded', 429, {
            current: monthlySpent,
            max: entitlement.monthlyCreditLimit,
            need: expectedCredits,
          });
        }
      }
    });
  }

  /** 从 input 提取分辨率（如 "1280x720"）。 */
  private resolveResolution(input: Record<string, unknown>): string | null {
    const w = input.width ? Number(input.width) : NaN;
    const h = input.height ? Number(input.height) : NaN;
    if (Number.isFinite(w) && Number.isFinite(h)) return `${w}x${h}`;
    if (typeof input.resolution === 'string' && input.resolution) return input.resolution;
    return null;
  }

  /**
   * 从 input 提取视频时长（秒）。
   *
   * 使用共享的 resolveVideoDurationFromInput 统一计算：
   * 优先从 numFrames / frameRate 推导（Agnes 原生参数），
   * fallback 到显式 duration 字段。
   *
   * 这样 UI、entitlement、cost、provider 全部使用同一套 duration 语义。
   */
  private resolveDuration(input: Record<string, unknown>): number | null {
    return resolveVideoDurationFromInput(input);
  }
}