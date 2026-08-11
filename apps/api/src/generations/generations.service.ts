import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import {
  domainError,
  ERROR_CODES,
  GENERATION_JOB_NAMES,
  GENERATION_STATUSES,
  QUEUES,
  type GenerationJobPayload,
  type GenerationStatus,
  type GenerationType,
} from '@enova/contracts';
import { generationJobs, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { PricingService } from '../billing/pricing.service.js';
import { WalletService } from '../billing/wallet.service.js';

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
  createdAt: Date;
  completedAt?: Date | null;
}

/**
 * Generation 统一任务系统。
 * 流程：validate → quote pricing → reserve credits → insert GenerationJob → enqueue BullMQ → 返回 jobId。
 * HTTP 请求不等待 Provider 完成，一律异步。
 */
@Injectable()
export class GenerationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @InjectQueue(QUEUES.GENERATION) private readonly queue: Queue<GenerationJobPayload>,
  ) {}

  async create(
    workspaceId: string,
    userId: string,
    type: GenerationType,
    provider: string,
    model: string,
    input: Record<string, unknown>,
  ): Promise<GenerationView> {
    const quote = await this.pricing.quote(type, provider, model);
    const credits = quote.credits;
    const jobId = crypto.randomUUID();

    // 单个事务内完成：reserve credits（行锁防超卖）+ 写 ledger + 插入 generation_job。
    const { job } = await this.db.transaction(async (tx) => {
      await this.wallet.reserveInTx(tx, workspaceId, jobId, credits, `reserve:${jobId}`);
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
          queuedAt: new Date(),
        })
        .returning();
      return { job: generationJob };
    });

    // 事务提交后再入队，避免预留成功但入队失败导致悬空任务。
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
    await this.queue.add(GENERATION_JOB_NAMES.PROCESS, payload);

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
        type: row.type,
        provider: row.provider ?? 'agnes',
        model: row.model ?? '',
        input: (row.inputJson ?? {}) as Record<string, unknown>,
        reservedCredits: row.reservedCredits,
        idempotencyKey: `settle:${row.id}`,
        stage: 'cancel',
      };
      await this.queue.add(GENERATION_JOB_NAMES.CANCEL, payload);
      return this.toView(row);
    }

    await this.queue.remove(jobKey(id));

    const [updated] = await this.db
      .update(generationJobs)
      .set({ status: GENERATION_STATUSES.CANCELED, canceledAt: new Date(), completedAt: new Date() })
      .where(and(eq(generationJobs.id, id), eq(generationJobs.workspaceId, workspaceId)))
      .returning();

    // 释放已预留 credits
    await this.wallet.release(workspaceId, id, `release:cancel:${id}`);

    return this.toView(updated);
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
    createdAt: Date;
    completedAt: Date | null;
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
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  }
}

function jobKey(id: string): string {
  // 与 GenerationProcessor 的 jobId 保持一致（BullMQ 默认 id 或自定义前缀）。
  return id;
}