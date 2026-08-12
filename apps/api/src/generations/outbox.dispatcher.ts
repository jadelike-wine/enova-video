import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { GENERATION_JOB_NAMES, type GenerationJobPayload } from '@enova/contracts';
import { generationDispatchOutbox, generationJobs, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { GENERATION_QUEUE } from '../queue/queue.module.js';

// drizzle-orm 的 .for() 不接受 'update skip locked'，使用 raw SQL 替代。

/**
 * Transactional Outbox Dispatcher (P0-2)。
 *
 * 解决问题：DB commit 后 queue.add() 失败导致孤儿任务（credits 已预留但 BullMQ 无 job）。
 *
 * 机制：
 * 1. Generation 创建时在同一事务内写入 outbox 行（PENDING）。
 * 2. Dispatcher 定期扫描 PENDING outbox 行，使用 SELECT ... FOR UPDATE SKIP LOCKED
 *    防止多实例并发重复投递。
 * 3. queue.add(jobId = generationJobId) → BullMQ 幂等去重。
 * 4. 标记 outbox 为 DISPATCHED。
 * 5. 失败时递增 attempts + 退避重试。
 *
 * Reconciliation：
 * - 扫描 QUEUED 状态的 generation_jobs 但无 DISPATCHED outbox → 自动 replay。
 * - 可由 Admin 手动触发 replay。
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs = 5_000;
  private readonly maxAttempts = 10;
  private readonly backoffBaseMs = 10_000;
  private readonly batchSize = 50;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobPayload>,
  ) {}

  onModuleInit(): void {
    // 启动定时 dispatcher（5 秒间隔）：既投递 PENDING outbox，也定期 reconcile 孤儿任务。
    // 防止出现"QUEUED + RESERVED 但无可投递 outbox"的永久卡死（SUPERSEDED / 崩溃丢失）。
    this.timer = setInterval(() => {
      void this.dispatchBatch().catch((err) => {
        this.logError('dispatchBatch', err);
      });
      void this.reconcileOrphanJobs().catch((err) => {
        this.logError('reconcileOrphanJobs', err);
      });
    }, this.pollIntervalMs);
  }

  private logError(op: string, err: unknown): void {
    // 静默重试，但保留可观测性（避免吞掉错误导致 reconcile 无人知晓地停摆）。
    this.logger.error(`outbox ${op} failed`, err instanceof Error ? err.message : String(err));
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 批量投递 PENDING outbox 条目到 BullMQ。
   * 使用 FOR UPDATE SKIP LOCKED 保证多实例安全。
   */
  async dispatchBatch(): Promise<{ dispatched: number }> {
    let dispatched = 0;

    await this.db.transaction(async (tx) => {
      // SKIP LOCKED：多实例并发时各取不同行，不阻塞。
      // drizzle-orm 的 .for() 类型不接受 'update skip locked'，用 raw SQL。
      const pending = await tx.execute(
        sql`SELECT * FROM generation_dispatch_outbox
            WHERE status = 'PENDING' AND available_at <= now()
            FOR UPDATE SKIP LOCKED
            LIMIT ${this.batchSize}`,
      );

      const rows = pending.rows as Array<{
        id: string;
        generation_job_id: string;
        event_type: string;
        payload_json: Record<string, unknown> | null;
        attempts: number;
      }>;

      for (const entry of rows) {
        if (entry.attempts >= this.maxAttempts) {
          await tx
            .update(generationDispatchOutbox)
            .set({ status: 'SUPERSEDED', lastError: 'Max dispatch attempts exceeded' })
            .where(eq(generationDispatchOutbox.id, entry.id));
          continue;
        }

        try {
          const payload = (entry.payload_json ?? {}) as unknown as GenerationJobPayload;
          const jobId = entry.event_type === 'CANCEL'
            ? `${entry.generation_job_id}:cancel`
            : entry.generation_job_id;

          await this.queue.add(
            entry.event_type === 'CANCEL' ? GENERATION_JOB_NAMES.CANCEL : GENERATION_JOB_NAMES.PROCESS,
            payload,
            { jobId },
          );

          await tx
            .update(generationDispatchOutbox)
            .set({
              status: 'DISPATCHED',
              attempts: entry.attempts + 1,
              dispatchedAt: new Date(),
            })
            .where(eq(generationDispatchOutbox.id, entry.id));

          dispatched++;
        } catch (err) {
          const nextAttempt = entry.attempts + 1;
          const backoff = this.backoffBaseMs * Math.pow(2, Math.min(nextAttempt, 8));
          await tx
            .update(generationDispatchOutbox)
            .set({
              attempts: nextAttempt,
              lastError: err instanceof Error ? err.message : String(err),
              availableAt: new Date(Date.now() + backoff),
            })
            .where(eq(generationDispatchOutbox.id, entry.id));
        }
      }
    });

    return { dispatched };
  }

  /**
   * Reconciliation：扫描 QUEUED 状态但无活跃 outbox 的 generation_jobs，确保存在一条可投递的 PROCESS outbox。
   *
   * 竞态安全（P0 红队修复）：
   * - 底层唯一索引 (generation_job_id, event_type) 保证同一 job 至多一条 PROCESS outbox 行，
   *   两个 dispatcher 实例并发 reconcile 时不可能各插入一条 → 不会重复投递/重复执行。
   * - 对已存在的 SUPERSEDED 行做"复活"（UPDATE → PENDING），而非再插一条新行。
   * - 新建走 INSERT ... ON CONFLICT DO NOTHING，已存在则静默跳过。
   *
   * 语义：SUPERSEDED 只可能是"投递耗尽 maxAttempts"。cancel 路径已把 outbox 置 SUPERSEDED **且**
   * job 置 CANCELED（同一事务），因此 QUEUED + SUPERSEDED 必然是需要恢复的孤儿，不会误复活已取消任务。
   */
  async reconcileOrphanJobs(): Promise<{ replayed: number }> {
    // 查找 QUEUED 状态的 job 作为孤儿候选。
    const orphans = await this.db
      .select({
        jobId: generationJobs.id,
        workspaceId: generationJobs.workspaceId,
        userId: generationJobs.userId,
        type: generationJobs.type,
        provider: generationJobs.provider,
        model: generationJobs.model,
        inputJson: generationJobs.inputJson,
        reservedCredits: generationJobs.reservedCredits,
      })
      .from(generationJobs)
      .where(eq(generationJobs.status, 'QUEUED'))
      .limit(this.batchSize);

    let replayed = 0;
    for (const job of orphans) {
      const payload: GenerationJobPayload = {
        generationJobId: job.jobId,
        workspaceId: job.workspaceId,
        userId: job.userId,
        type: job.type as GenerationJobPayload['type'],
        provider: job.provider ?? 'agnes',
        model: job.model ?? '',
        input: (job.inputJson ?? {}) as Record<string, unknown>,
        reservedCredits: job.reservedCredits,
        idempotencyKey: `settle:${job.jobId}`,
      };

      // 1) 若存在 SUPERSEDED 或 DISPATCHED 的 PROCESS 行且 job 仍 QUEUED：复活为 PENDING。
      //    - SUPERSEDED：投递耗尽 maxAttempts 的孤儿，必须恢复。
      //    - DISPATCHED：queue.add 已成功且 outbox 已被标记 DISPATCHED，但 BullMQ 可能丢失了
      //      job（如 Redis 抖动/清空），job 仍停在 QUEUED。必须恢复，否则永久卡死。
      //      安全：BullMQ jobId = generationJobId，重复 add 是幂等去重的，不会产生重复执行。
      const revived = await this.db
        .update(generationDispatchOutbox)
        .set({ status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null })
        .where(
          and(
            eq(generationDispatchOutbox.generationJobId, job.jobId),
            eq(generationDispatchOutbox.eventType, 'PROCESS'),
            inArray(generationDispatchOutbox.status, ['SUPERSEDED', 'DISPATCHED']),
          ),
        )
        .returning({ id: generationDispatchOutbox.id });

      // 2) 若无任何 PROCESS 行：新建一条 PENDING。唯一索引兜底并发，已存在则 DO NOTHING。
      const inserted = await this.db
        .insert(generationDispatchOutbox)
        .values({
          generationJobId: job.jobId,
          eventType: 'PROCESS',
          payloadJson: payload as unknown as Record<string, unknown>,
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
        })
        .onConflictDoNothing({
          target: [generationDispatchOutbox.generationJobId, generationDispatchOutbox.eventType],
        })
        .returning({ id: generationDispatchOutbox.id });

      if (revived.length > 0 || inserted.length > 0) replayed++;
    }

    return { replayed };
  }

  /** Admin 手动 replay 指定 job 的 outbox。 */
  async forceReplay(generationJobId: string): Promise<void> {
    await this.db
      .update(generationDispatchOutbox)
      .set({ status: 'PENDING', availableAt: new Date(), lastError: null })
      .where(
        and(
          eq(generationDispatchOutbox.generationJobId, generationJobId),
          eq(generationDispatchOutbox.status, 'SUPERSEDED'),
        ),
      );
  }
}
