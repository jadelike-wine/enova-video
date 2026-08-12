import { and, desc, eq, sql } from 'drizzle-orm';
import { generationAttempts, generationJobs, type Database } from '@enova/db';
import type { Tx } from '@enova/billing';

/**
 * Generation Attempts 仓库（P0-5）。
 *
 * 每次 Worker 真正调用 Provider（提交/生成/轮询查询）都产生一条 attempt 记录，
 * 记录 provider/model/credential/provider_job_id/状态/成本。
 *
 * 不变量：
 * - unique(generation_job_id, attempt_no) → 同一 job 内 attempt_no 递增、不重复。
 * - 失败 attempt 也保留成本（reportedCostMicrousd / estimatedCostMicrousd），不丢失。
 * - attempt_no 由 DB 自动递增（基于该 job 当前最大值 + 1）。
 *
 * 不依赖 NestJS，可直接实例化。
 */
export class GenerationAttemptsRepo {
  constructor(private readonly db: Database) {}

  /**
   * 开启一次 attempt：分配 attempt_no（job 内递增）+ 插入 RUNNING 记录。
   * 并发安全：使用 unique 约束兜底，冲突时重取下一个 attempt_no。
   */
  async start(args: {
    generationJobId: string;
    provider: string;
    model: string;
    credentialId?: string;
    providerJobId?: string;
    estimatedCostMicrousd?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ attemptId: string; attemptNo: number }> {
    // 查询当前 job 的最大 attempt_no。
    const maxRows = await this.db
      .select({ maxNo: sql<number>`coalesce(max(${generationAttempts.attemptNo}), 0)` })
      .from(generationAttempts)
      .where(eq(generationAttempts.generationJobId, args.generationJobId));
    const nextNo = (maxRows[0]?.maxNo ?? 0) + 1;
    const attemptId = crypto.randomUUID();

    try {
      await this.db.insert(generationAttempts).values({
        id: attemptId,
        generationJobId: args.generationJobId,
        attemptNo: nextNo,
        provider: args.provider,
        model: args.model,
        credentialId: args.credentialId ?? null,
        providerJobId: args.providerJobId ?? null,
        status: 'RUNNING',
        estimatedCostMicrousd: args.estimatedCostMicrousd ?? 0,
        metadata: args.metadata ?? null,
      });
    } catch {
      // 并发冲突（unique on generation_job_id+attempt_no）：重取一次。
      const retryRows = await this.db
        .select({ maxNo: sql<number>`coalesce(max(${generationAttempts.attemptNo}), 0)` })
        .from(generationAttempts)
        .where(eq(generationAttempts.generationJobId, args.generationJobId));
      const retryNo = (retryRows[0]?.maxNo ?? 0) + 1;
      const retryId = crypto.randomUUID();
      await this.db.insert(generationAttempts).values({
        id: retryId,
        generationJobId: args.generationJobId,
        attemptNo: retryNo,
        provider: args.provider,
        model: args.model,
        credentialId: args.credentialId ?? null,
        providerJobId: args.providerJobId ?? null,
        status: 'RUNNING',
        estimatedCostMicrousd: args.estimatedCostMicrousd ?? 0,
        metadata: args.metadata ?? null,
      });
      return { attemptId: retryId, attemptNo: retryNo };
    }

    // 同步刷新 generation_jobs.attempt_count（便于快速查询，非关键路径）。
    await this.db
      .update(generationJobs)
      .set({ attemptCount: nextNo })
      .where(eq(generationJobs.id, args.generationJobId));

    return { attemptId, attemptNo: nextNo };
  }

  /** 标记 attempt 成功，记录 provider 回报的成本。 */
  async markSucceeded(attemptId: string, reportedCostMicrousd = 0, metadata?: Record<string, unknown>): Promise<void> {
    await this.db
      .update(generationAttempts)
      .set({
        status: 'SUCCEEDED',
        reportedCostMicrousd,
        endedAt: new Date(),
        metadata: metadata ?? undefined,
      })
      .where(eq(generationAttempts.id, attemptId));
  }

  /** 标记 attempt 失败，保留估算成本（失败调用也产生成本）。 */
  async markFailed(
    attemptId: string,
    errorCode: string,
    errorMessage: string,
    reportedCostMicrousd = 0,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(generationAttempts)
      .set({
        status: 'FAILED',
        errorCode,
        errorMessage,
        reportedCostMicrousd,
        endedAt: new Date(),
        metadata: metadata ?? undefined,
      })
      .where(eq(generationAttempts.id, attemptId));
  }

  /** 标记 attempt 已取消。 */
  async markCanceled(attemptId: string): Promise<void> {
    await this.db
      .update(generationAttempts)
      .set({ status: 'CANCELED', endedAt: new Date() })
      .where(eq(generationAttempts.id, attemptId));
  }

  /** 关联 provider_job_id（视频提交后回填）。 */
  async attachProviderJobId(attemptId: string, providerJobId: string): Promise<void> {
    await this.db
      .update(generationAttempts)
      .set({ providerJobId })
      .where(eq(generationAttempts.id, attemptId));
  }

  /** 列出某 job 的全部 attempts（按 attempt_no 升序）。 */
  async listByJob(generationJobId: string) {
    return this.db
      .select()
      .from(generationAttempts)
      .where(eq(generationAttempts.generationJobId, generationJobId))
      .orderBy(generationAttempts.attemptNo);
  }

  /** 获取该 job 当前活跃的 RUNNING attempt（如果有）。 */
  async findRunning(generationJobId: string) {
    const rows = await this.db
      .select()
      .from(generationAttempts)
      .where(and(eq(generationAttempts.generationJobId, generationJobId), eq(generationAttempts.status, 'RUNNING')))
      .orderBy(desc(generationAttempts.attemptNo))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 在事务内回填 provider_job_id 到当前 RUNNING attempt（视频提交场景）。
   * 用于 finalizeSuccessInTx 同事务内一致地更新 attempt。
   */
  async attachProviderJobIdInTx(tx: Tx, attemptId: string, providerJobId: string): Promise<void> {
    await tx
      .update(generationAttempts)
      .set({ providerJobId })
      .where(eq(generationAttempts.id, attemptId));
  }
}
