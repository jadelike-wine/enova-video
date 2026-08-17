import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  domainError,
  ERROR_CODES,
  GENERATION_STATUSES,
  type GenerationJobPayload,
  type GenerationStatus,
  type GenerationType,
} from '@enova/contracts';
import { generationDispatchOutbox, generationJobs, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { GENERATION_QUEUE } from '../queue/queue.module.js';
import { PricingService } from '../billing/pricing.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { EntitlementService } from '@enova/billing';
import { SettingsService } from '../settings/settings.service.js';
import { EnovaLogger } from '../common/logger/enova-logger.js';
import type { Queue } from 'bullmq';

export interface GenerationView {
  id: string;
  type: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  estimatedCredits: number;
  reservedCredits: number;
  actualCredits: number;
  estimatedCostMicrousd: number;
  reportedCostMicrousd: number;
  finalCostMicrousd: number;
  costStatus: string;
  attemptCount: number;
  createdAt: Date;
  completedAt?: Date | null;
}

/**
 * Generation 统一任务系统（P0-2: Transactional Outbox + P0-3: Pricing Quote）。
 *
 * 流程：validate → quote pricing（创建不可变 PriceQuote）→ reserve credits →
 *       insert GenerationJob + 写 outbox（同一事务）→ OutboxDispatcher 异步投递 BullMQ。
 *
 * 保证：
 * - DB commit 与 queue.add 原子一致（outbox 模式），不会产生孤儿任务。
 * - BullMQ jobId = generationJobId，重复 dispatch 不产生多个实际任务。
 * - 历史价格可追溯（PriceQuote + PricingVersion 不可变）。
 */
@Injectable()
export class GenerationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobPayload>,
    @Inject(EntitlementService) private readonly entitlement: EntitlementService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Optional() @Inject(EnovaLogger) private readonly logger?: EnovaLogger,
  ) {}

  /** 从动态配置获取当前 job 级别 options。 */
  private async getJobOpts(): Promise<{ attempts: number; backoff: { type: 'exponential'; delay: number } }> {
    const attempts = (await this.settings.getNumber('queue.jobAttempts')) ?? 5;
    const backoffMs = (await this.settings.getNumber('queue.jobBackoffMs')) ?? 5_000;
    return { attempts, backoff: { type: 'exponential', delay: backoffMs } };
  }

  async create(
    workspaceId: string,
    userId: string,
    type: GenerationType,
    provider: string,
    model: string,
    input: Record<string, unknown>,
  ): Promise<GenerationView> {
    // P0-3: 创建不可变 PriceQuote（含 pricing version + estimated cost）。
    const quote = await this.pricing.quote({ type, provider, model, dimensions: input });
    const credits = quote.credits;
    const jobId = crypto.randomUUID();

    // P1-2: 创建任务前做用户级限额检查（并发/日/月配额/模型/分辨率/时长/credits 配额）。
    // optional=true：无有效订阅时不阻断（允许免费 credits 生成），有订阅则强制遵守 Plan Entitlement。
    // 超限抛明确业务错误（CONCURRENCY_LIMIT_REACHED / DAILY_QUOTA_EXCEEDED / MODEL_NOT_ALLOWED 等）。
    await this.entitlement.authorizeJob({
      workspaceId,
      type,
      model,
      input,
      expectedCredits: credits,
      optional: true,
    });

    // P0-2: 单个事务内完成 插入 generation_job + reserve + 写 outbox。
    // 事务提交后由 OutboxDispatcher 异步投递 BullMQ，避免 orphan job。
    //
    // 顺序不变量：必须先 INSERT generation_jobs，再 reserveInTx。
    // credit_reservations.generation_job_id 有外键约束引用 generation_jobs.id，
    // 若先 reserve 会因外键不存在导致 FK violation（生产已确认该 bug）。
    // 若 reserve 失败（余额不足），事务回滚，generation_jobs 行也会回滚。
    const { job } = await this.db.transaction(async (tx) => {
      const [generationJob] = await tx
        .insert(generationJobs)
        .values({
          id: jobId,
          workspaceId,
          userId,
          type,
          status: GENERATION_STATUSES.QUEUED,
          provider,
          model,
          inputJson: input,
          estimatedCredits: credits,
          reservedCredits: credits,
          estimatedCostMicrousd: quote.estimatedCostMicrousd,
          costStatus: 'ESTIMATED',
          pricingVersionId: quote.pricingVersionId,
          priceQuoteId: quote.quoteId,
          queuedAt: new Date(),
        })
        .returning();

      await this.wallet.reserveInTx(tx, workspaceId, jobId, credits, `reserve:${jobId}`);

      // 写 outbox：OutboxDispatcher 会读取并投递到 BullMQ。
      const payload: GenerationJobPayload = {
        generationJobId: jobId,
        workspaceId,
        userId,
        type,
        provider,
        model,
        input,
        reservedCredits: credits,
        idempotencyKey: `settle:${jobId}`,
      };
      await tx.insert(generationDispatchOutbox).values({
        generationJobId: jobId,
        eventType: 'PROCESS',
        payloadJson: payload as unknown as Record<string, unknown>,
        status: 'PENDING',
        availableAt: new Date(),
      });

      return { job: generationJob };
    });

    if (this.logger) {
      const fields: Record<string, unknown> = { generationJobId: jobId, workspaceId, type, provider, model };
      if (await this.settings.getLogPrompts()) fields.prompt = typeof input.prompt === 'string' ? input.prompt : undefined;
      this.logger.info('generation job queued', fields);
    }

    return this.toView(job);
  }

  async get(workspaceId: string, id: string): Promise<GenerationView> {
    const row = await this.findByIdAndWorkspace(workspaceId, id);
    if (!row) throw domainError(ERROR_CODES.GENERATION_NOT_FOUND, 'Generation not found', 404);
    return this.toView(row);
  }

  async list(workspaceId: string, limit: number): Promise<GenerationView[]> {
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.workspaceId, workspaceId))
      .orderBy(desc(generationJobs.createdAt))
      .limit(limit);
    return rows.map((r) => this.toView(r));
  }

  async cancel(workspaceId: string, id: string): Promise<GenerationView> {
    const row = await this.findByIdAndWorkspace(workspaceId, id);
    if (!row) throw domainError(ERROR_CODES.GENERATION_NOT_FOUND, 'Generation not found', 404);

    const status = row.status as GenerationStatus;
    const cancellable: GenerationStatus[] = [
      GENERATION_STATUSES.PENDING,
      GENERATION_STATUSES.QUEUED,
      GENERATION_STATUSES.RUNNING,
    ];
    if (!cancellable.includes(status)) {
      throw domainError(ERROR_CODES.GENERATION_INVALID_STATUS_TRANSITION, 'Job cannot be canceled', 409);
    }

    // RUNNING（视频已在轮询循环）：无法从队列直接摘除（延迟 job 已飞走），
    // 把取消交给 Worker——由它通知上游 cancelJob，再原子标记 CANCELED + 释放 credits。
    if (status === GENERATION_STATUSES.RUNNING) {
      const payload: GenerationJobPayload = {
        generationJobId: row.id,
        workspaceId: row.workspaceId,
        userId: row.userId,
        type: row.type as GenerationType,
        provider: row.provider ?? 'agnes',
        model: row.model ?? '',
        input: (row.inputJson ?? {}) as Record<string, unknown>,
        reservedCredits: row.reservedCredits,
        idempotencyKey: `settle:${row.id}`,
        stage: 'cancel',
      };
      // CANCEL 事件直接入队（不经过 outbox，因为需要立即处理）。
      const jobOpts = await this.getJobOpts();
      await this.queue.add('generation.cancel', payload, { jobId: `${row.id}:cancel`, attempts: jobOpts.attempts, backoff: jobOpts.backoff });
      return this.toView(row);
    }

    // PENDING/QUEUED cancel：必须在一个事务内原子完成
    //   outbox → SUPERSEDED（阻止 dispatcher 投递）
    //   job    → CANCELED
    //   wallet → release（回滚预留 credits）
    // P0 红队修复：原来三段是独立 SQL。若进程在 outbox SUPERSEDED 之后、job CANCELED 之前崩溃，
    // 会留下 "outbox=SUPERSEDED 但 job=QUEUED + credits=RESERVED" 的分裂态；reconcile 会把它当孤儿
    // 重新投递，导致"用户已取消却仍被执行扣费"。原子化后要么全提交（CANCELED+released），
    // 要么整事务回滚（仍可正常投递），彻底消除该窗口。
    const releaseKey = `release:cancel:${id}`;
    await this.db.transaction(async (tx) => {
      await tx
        .update(generationDispatchOutbox)
        .set({ status: 'SUPERSEDED' })
        .where(
          and(
            eq(generationDispatchOutbox.generationJobId, id),
            eq(generationDispatchOutbox.status, 'PENDING'),
          ),
        );

      const [updated] = await tx
        .update(generationJobs)
        .set({ status: GENERATION_STATUSES.CANCELED, canceledAt: new Date(), completedAt: new Date() })
        .where(
          and(
            eq(generationJobs.id, id),
            eq(generationJobs.workspaceId, workspaceId),
            inArray(generationJobs.status, [
              GENERATION_STATUSES.PENDING,
              GENERATION_STATUSES.QUEUED,
            ]),
          ),
        )
        .returning();

      if (!updated) {
        // job 已不在 PENDING/QUEUED（可能已被 dispatch 为 RUNNING 或已终态）：
        // 不能在此路径取消，交给调用方重试（重试时按 RUNNING 走 worker cancel）。
        throw domainError(ERROR_CODES.GENERATION_INVALID_STATUS_TRANSITION, 'Job cannot be canceled', 409);
      }

      await this.wallet.releaseInTx(tx, workspaceId, id, releaseKey);
    });

    // 尝试从 BullMQ 移除（jobId = generationJobId）。best-effort：job 可能已被消费或不存在。
    try {
      await this.queue.remove(id);
    } catch {
      // 忽略。
    }

    return this.toView({
      ...row,
      status: GENERATION_STATUSES.CANCELED,
      canceledAt: new Date(),
      completedAt: new Date(),
    });
  }

  /** IDOR 安全：按 id + workspace 查询。 */
  private async findByIdAndWorkspace(workspaceId: string, id: string) {
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.id, id), eq(generationJobs.workspaceId, workspaceId)))
      .limit(1);
    return rows[0];
  }

  private toView(r: {
    id: string;
    type: GenerationType;
    status: string;
    provider: string | null;
    model: string | null;
    inputJson: Record<string, unknown> | null;
    outputJson: Record<string, unknown> | null;
    errorCode: string | null;
    errorMessage: string | null;
    estimatedCredits: number;
    reservedCredits: number;
    actualCredits: number;
    estimatedCostMicrousd: number;
    reportedCostMicrousd: number;
    finalCostMicrousd: number;
    costStatus: string;
    attemptCount: number;
    createdAt: Date;
    completedAt: Date | null;
    canceledAt?: Date | null;
  }): GenerationView {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      provider: r.provider,
      model: r.model,
      input: r.inputJson,
      output: r.outputJson,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      estimatedCredits: r.estimatedCredits,
      reservedCredits: r.reservedCredits,
      actualCredits: r.actualCredits,
      estimatedCostMicrousd: r.estimatedCostMicrousd,
      reportedCostMicrousd: r.reportedCostMicrousd,
      finalCostMicrousd: r.finalCostMicrousd,
      costStatus: r.costStatus,
      attemptCount: r.attemptCount,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  }
}
