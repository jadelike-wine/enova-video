import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { GENERATION_STATUSES } from '@enova/contracts';
import type { Tx } from '@enova/billing';
import { generationJobs, pricingRules, usageEvents, assets, type Database } from '@enova/db';

/**
 * GenerationJob 持久化仓库。
 * 封装 Worker 对 generation_jobs / assets / usage_events 的读写，
 * 所有状态迁移经过 state.ts 校验；finalize 在事务内原子完成。
 */

export interface GenerationJobRow {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  status: string;
  provider: string | null;
  model: string | null;
  inputJson: Record<string, unknown> | null;
  providerJobId: string | null;
  providerStartedAt: Date | null;
  pollCount: number;
  reservedCredits: number;
  /** P0-4: 估算成本（微美元），来自 PriceQuote 快照。 */
  estimatedCostMicrousd: number;
  createdAt: Date;
}

export interface FinalizeSuccessArgs {
  workspaceId: string;
  userId: string;
  generationJobId: string;
  type: string;
  provider: string;
  model: string;
  /** 主 Asset 元数据。 */
  asset: {
    mediaType: 'image' | 'video';
    storageProvider: string | null;
    bucket: string | null;
    objectKey: string | null;
    mimeType: string;
    size: number;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    metadata?: Record<string, unknown>;
  };
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    duration?: number | null;
    resolution?: string | null;
    /** @deprecated 保留兼容；新逻辑使用 estimatedCostMicrousd。 */
    providerCostUsd?: number;
    creditsCharged: number;
    metadata?: Record<string, unknown>;
  };
  actualCredits: number;
  /** @deprecated 保留兼容；新逻辑使用 finalCostMicrousd。 */
  actualCostUsd?: number;
  /** P0-4: 成本语义（微美元）。 */
  estimatedCostMicrousd?: number;
  reportedCostMicrousd?: number;
  finalCostMicrousd?: number;
  costStatus?: 'ESTIMATED' | 'REPORTED' | 'RECONCILED';
  /** 供前端展示的最终产物信息（持久化到 generation_jobs.output_json）。 */
  output?: {
    url?: string | null;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    mimeType?: string | null;
    storageProvider?: string | null;
  };
}

export class GenerationRepo {
  constructor(private readonly db: Database) {}

  async load(id: string): Promise<GenerationJobRow | null> {
    const rows = await this.db
      .select({
        id: generationJobs.id,
        workspaceId: generationJobs.workspaceId,
        userId: generationJobs.userId,
        type: generationJobs.type,
        status: generationJobs.status,
        provider: generationJobs.provider,
        model: generationJobs.model,
        inputJson: generationJobs.inputJson,
        providerJobId: generationJobs.providerJobId,
        providerStartedAt: generationJobs.providerStartedAt,
        pollCount: generationJobs.pollCount,
        reservedCredits: generationJobs.reservedCredits,
        estimatedCostMicrousd: generationJobs.estimatedCostMicrousd,
        createdAt: generationJobs.createdAt,
      })
      .from(generationJobs)
      .where(eq(generationJobs.id, id))
      .limit(1);
    return (rows[0] as GenerationJobRow | undefined) ?? null;
  }

  /**
   * 条件迁移到 RUNNING。允许 PENDING/QUEUED/RUNNING（重试可重入）。
   * 返回 false 表示未生效（对方已处理 / 已终态），调用方应跳过。
   */
  async toRunning(id: string): Promise<boolean> {
    const rows = await this.db
      .update(generationJobs)
      .set({ status: GENERATION_STATUSES.RUNNING, startedAt: new Date() })
      .where(
        and(
          eq(generationJobs.id, id),
          inArray(generationJobs.status, [
            GENERATION_STATUSES.PENDING,
            GENERATION_STATUSES.QUEUED,
            GENERATION_STATUSES.RUNNING,
          ]),
        ),
      )
      .returning({ id: generationJobs.id });
    return rows.length === 1;
  }

  /**
   * 持久化 provider_job_id（幂等）：仅在尚无 provider_job_id 时写入。
   * 防止 Worker 崩溃重跑时重复提交导致重复计费。
   */
  async persistProviderJob(id: string, providerJobId: string): Promise<boolean> {
    const rows = await this.db
      .update(generationJobs)
      .set({ providerJobId, providerStartedAt: new Date() })
      .where(and(eq(generationJobs.id, id), isNull(generationJobs.providerJobId)))
      .returning({ id: generationJobs.id });
    return rows.length === 1;
  }

  /** 原子递增 poll_count，返回新值（用于判断是否超时）。 */
  async incrementPoll(id: string): Promise<number> {
    const rows = await this.db
      .update(generationJobs)
      .set({ pollCount: sql`${generationJobs.pollCount} + 1` })
      .where(eq(generationJobs.id, id))
      .returning({ pollCount: generationJobs.pollCount });
    return rows[0]?.pollCount ?? 0;
  }

  /**
   * 解析定价规则中的供应商成本（微美元）。
   * 单一数据源= pricing_rules.pricingJson.providerCostUsd；未配置或缺失时默认 0（不伪造成本）。
   */
  async providerCostUsd(type: string, provider: string, model: string): Promise<number> {
    const rows = await this.db
      .select({ pricingJson: pricingRules.pricingJson })
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.generationType, type as never),
          eq(pricingRules.provider, provider),
          eq(pricingRules.model, model),
          eq(pricingRules.enabled, true),
        ),
      )
      .limit(1);
    const rule = rows[0];
    const pc = rule?.pricingJson as { providerCostUsd?: unknown } | undefined;
    return typeof pc?.providerCostUsd === 'number' ? pc.providerCostUsd : 0;
  }

  /**
   * 成功 finalize（事务内）：asset upsert（幂等）+ usage insert + job → SUCCEEDED。
   * 由调用方把本方法与本事务内的 WalletGateway.settleInTx 一并提交，保证原子一致。
   */
  async finalizeSuccessInTx(tx: Tx, args: FinalizeSuccessArgs): Promise<void> {
    // Asset 幂等：generation_job_id 唯一索引，冲突时 noop，避免重试重复插入。
    await tx
      .insert(assets)
      .values({
        workspaceId: args.workspaceId,
        userId: args.userId,
        generationJobId: args.generationJobId,
        type: args.asset.mediaType === 'video' ? 'VIDEO' : 'IMAGE',
        storageProvider: args.asset.storageProvider,
        bucket: args.asset.bucket,
        objectKey: args.asset.objectKey,
        mimeType: args.asset.mimeType,
        size: args.asset.size,
        width: args.asset.width ?? null,
        height: args.asset.height ?? null,
        duration: args.asset.duration ?? null,
        metadata: args.asset.metadata,
      })
      .onConflictDoNothing({ target: assets.generationJobId });

    // Usage；同一事务内，先查后插避免重复（job 已被 RUNNING 条件守卫）。
    const existing = await tx
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.generationJobId, args.generationJobId))
      .limit(1);
    if (existing.length === 0) {
      await tx.insert(usageEvents).values({
        workspaceId: args.workspaceId,
        userId: args.userId,
        generationJobId: args.generationJobId,
        provider: args.provider,
        model: args.model,
        type: (args.type as 'IMAGE' | 'VIDEO') ?? 'IMAGE',
        inputTokens: args.usage.inputTokens ?? 0,
        outputTokens: args.usage.outputTokens ?? 0,
        duration: args.usage.duration ?? null,
        resolution: args.usage.resolution ?? null,
        providerCostUsd: args.usage.providerCostUsd ?? 0,
        creditsCharged: args.usage.creditsCharged,
        metadata: args.usage.metadata,
        // P0-4: 写入明确的成本语义（微美元）。
        estimatedCostMicrousd: args.estimatedCostMicrousd ?? 0,
        reportedCostMicrousd: args.reportedCostMicrousd ?? 0,
        finalCostMicrousd: args.finalCostMicrousd ?? 0,
        costStatus: args.costStatus ?? 'ESTIMATED',
      });
    }

    const updated = await tx
      .update(generationJobs)
      .set({
        status: GENERATION_STATUSES.SUCCEEDED,
        actualCredits: args.actualCredits,
        actualCostUsd: args.actualCostUsd ?? 0,
        outputJson: args.output ?? null,
        completedAt: new Date(),
        // P0-4: 同步 job 上的成本字段，保证 Job 与 UsageEvent 成本一致。
        // P0 红队修复：final_cost 只在成本最终化时写入；ESTIMATED 阶段用 0，禁止把估算值塞进 final。
        reportedCostMicrousd: args.reportedCostMicrousd ?? 0,
        finalCostMicrousd: args.finalCostMicrousd ?? 0,
        costStatus: args.costStatus ?? 'ESTIMATED',
      })
      .where(
        and(
          eq(generationJobs.id, args.generationJobId),
          inArray(generationJobs.status, [
            GENERATION_STATUSES.QUEUED,
            GENERATION_STATUSES.RUNNING,
            GENERATION_STATUSES.SUCCEEDED,
          ]),
        ),
      )
      .returning({ id: generationJobs.id });

    // P0 红队修复：cancel/dispatch 竞态下，若 job 已被置为 CANCELED/FAILED（本次 UPDATE 未命中任何行），
    // 必须抛错让整个事务（含 WalletGateway.settleInTx）回滚，禁止"状态已取消/失败却仍扣费"。
    // 幂等重试（job 已 SUCCEEDED）会命中 SUCCEEDED 分支返回一行，仍正常放行。
    if (updated.length === 0) {
      throw new Error(
        `finalizeSuccess aborted: generation job ${args.generationJobId} is no longer runnable (canceled/failed concurrently)`,
      );
    }
  }

  /** 终态标记 FAILED（供事务内 finalizeFailure 使用）。 */
  async finalizeFailureInTx(
    tx: Tx,
    args: { id: string; errorCode: string; errorMessage: string },
  ): Promise<void> {
    await tx
      .update(generationJobs)
      .set({
        status: GENERATION_STATUSES.FAILED,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, args.id),
          inArray(generationJobs.status, [
            GENERATION_STATUSES.QUEUED,
            GENERATION_STATUSES.RUNNING,
          ]),
        ),
      );
  }

  /** 终态标记 CANCELED（供事务内取消使用）。仅 QUEUED / RUNNING 可迁移到 CANCELED。 */
  async finalizeCancelInTx(tx: Tx, args: { id: string }): Promise<void> {
    await tx
      .update(generationJobs)
      .set({
        status: GENERATION_STATUSES.CANCELED,
        canceledAt: new Date(),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, args.id),
          inArray(generationJobs.status, [
            GENERATION_STATUSES.QUEUED,
            GENERATION_STATUSES.RUNNING,
          ]),
        ),
      );
  }
}