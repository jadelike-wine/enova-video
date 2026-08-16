import type { Queue } from 'bullmq';
import {
  GENERATION_JOB_NAMES,
  QUEUES,
  type GenerationJobPayload,
  validateVideoFrames,
} from '@enova/contracts';
import type {
  AcquiredCredential,
  CredentialManager,
  GenerateImageInput,
  GenerateVideoInput,
  ObjectStorage,
  ProviderError,
  ProviderJobStatus,
  ProviderVideoSubmission,
  ProviderRegistry,
  UrlGuardOptions,
} from '@enova/provider';
import { WalletGateway } from '@enova/billing';
import { CostRevenueLedger, generateCostEventKey } from '@enova/billing';
import type { Database } from '@enova/db';
import { downloadToTempFile, cleanupTempFile } from '@enova/provider';
import { WorkerLogger } from '../logger.js';
import { GenerationAttemptsRepo } from './attempts.repo.js';
import { GenerationRepo, type GenerationJobRow } from './repo.js';
import { isTerminal, isRunnable } from './state.js';

/**
 * Generation 真实流水线：替换 GENERATION_PIPELINE_NOT_IMPLEMENTED 桩。
 *
 * 职责：load job → 条件 RUNNING → ProviderRegistry → CredentialManager.acquire →
 * Provider 执行 → 下载/转存 Storage → Asset+Usage+Settle(事务) → SUCCEEDED。
 *
 * 失败语义（两层，见设计文档）：
 * - transient（RATE_LIMITED / 5xx / timeout / network / 无可用 credential）→ 上抛，
 *   由 BullMQ 按 backoff 重试；**重试不 release credits**。
 * - permanent（PROVIDER_BAD_REQUEST / PROVIDER_JOB_FAILED / 轮询超时）→ 本方法内
 *   finalizeFailure（release + FAILED）并正常返回，不触发 BullMQ 重试。
 * - 最终失败（transient 重试耗尽）由 main.ts 的 worker.on('failed') release + FAILED。
 */
export interface GenerationPipelineConfig {
  pollIntervalMs: number;
  maxPolls: number;
  maxWaitMs: number;
  credentialRetryAttempts: number;
  download: {
    guard: UrlGuardOptions;
    maxBytes: number;
    timeoutMs: number;
  };
  allowedContentTypePrefixes: string[];
}

/**
 * 资源提供者：storage/registry/credentials 可在配置变更后热替换。
 * getConfig() 每次 job 执行时调用，获取最新动态配置。
 */
export interface PipelineResourceProvider {
  readonly storage: ObjectStorage;
  readonly registry: ProviderRegistry;
  readonly credentials: CredentialManager;
  getConfig(): Promise<GenerationPipelineConfig>;
}

export interface GenerationPipelineDeps {
  db: Database;
  repo: GenerationRepo;
  attempts: GenerationAttemptsRepo;
  resources: PipelineResourceProvider;
  wallet: WalletGateway;
  queue: Queue<GenerationJobPayload>;
  logger: WorkerLogger;
}

export class GenerationPipeline {
  constructor(private readonly deps: GenerationPipelineDeps) {}

  /** 获取当前动态配置（每次 job 执行时调用）。 */
  private async config(): Promise<GenerationPipelineConfig> {
    return this.deps.resources.getConfig();
  }

  private get storage(): ObjectStorage {
    return this.deps.resources.storage;
  }

  private get registry(): ProviderRegistry {
    return this.deps.resources.registry;
  }

  private get credentials(): CredentialManager {
    return this.deps.resources.credentials;
  }

  /** 执行阶段：IMAGE 直接生成；VIDEO 提交 + 排入延迟轮询。 */
  async execute(payload: GenerationJobPayload): Promise<void> {
    const job = await this.deps.repo.load(payload.generationJobId);
    if (!job) {
      this.deps.logger.warn('generation job not found', { generationJobId: payload.generationJobId });
      return;
    }
    if (isTerminal(job.status)) {
      this.deps.logger.info('generation job already terminal, skip', { generationJobId: job.id, status: job.status });
      return;
    }
    if (!isRunnable(job.status)) {
      this.deps.logger.warn('generation job not runnable', { generationJobId: job.id, status: job.status });
      return;
    }

    const ok = await this.deps.repo.toRunning(job.id);
    if (!ok) return; // 其它 Worker 已处理

    this.deps.logger.info('generation job started', {
      generationJobId: job.id,
      workspaceId: job.workspaceId,
      userId: job.userId,
      provider: job.provider ?? undefined,
      model: job.model ?? undefined,
      type: job.type,
      stage: 'execute',
    });

    if (job.type === 'IMAGE') {
      await this.runImage(job);
    } else if (job.type === 'VIDEO') {
      await this.runVideoExecute(job, payload);
    } else {
      await this.fail(job, 'UNSUPPORTED_GENERATION_TYPE', `Unsupported generation type: ${job.type}`);
    }
  }

  /** 轮询阶段：查询上游视频状态，未完成则排入下一次轮询，完成则 finalize。 */
  async poll(payload: GenerationJobPayload): Promise<void> {
    const job = await this.deps.repo.load(payload.generationJobId);
    if (!job) return;
    if (isTerminal(job.status)) return;
    if (job.status !== 'RUNNING') {
      this.deps.logger.warn('poll skipped: job not running', { generationJobId: job.id, status: job.status });
      return;
    }
    if (!job.providerJobId) {
      // 缺少 provider_job_id：可能是提交阶段崩溃，回到 execute 重新提交/续接。
      await this.execute(payload);
      return;
    }

    this.deps.logger.info('video poll start', {
      generationJobId: job.id,
      workspaceId: job.workspaceId,
      providerJobId: job.providerJobId,
      pollCount: job.pollCount,
      stage: 'poll',
    });

    let status: ProviderJobStatus;
    try {
      status = await this.withCredential(job.provider ?? 'agnes', async (cred) => {
        const provider = await this.registry.getProvider(job.provider ?? 'agnes');
        return provider.getVideoStatus(job.providerJobId!, this.buildVideoInput(job), cred.secret);
      });
    } catch (err) {
      // 轮询瞬时失败（无可用 credential / 5xx / timeout / network）：
      // 不触发 release，排入下一次轮询（由 maxPolls/maxWait 兜底），避免过早退款。
      this.deps.logger.warn('video poll transient failure, scheduling next poll', {
        generationJobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.handleVideoProcessing(job, payload);
      return;
    }

    if (status.status === 'processing') {
      await this.handleVideoProcessing(job, payload, status.progress);
    } else if (status.status === 'succeeded') {
      this.deps.logger.info('video succeeded', {
        generationJobId: job.id,
        providerJobId: job.providerJobId,
        sourceUrl: status.sourceUrl,
      });
      // P0-5: 视频成功 → 标记当前 RUNNING attempt 为 SUCCEEDED（保留估算成本）。
      const runningAttempt = await this.deps.attempts.findRunning(job.id);
      if (runningAttempt) {
        await this.deps.attempts.markSucceeded(runningAttempt.id, job.estimatedCostMicrousd);
      }
      await this.ingestAndFinalize(job, 'video', status, runningAttempt?.id);
    } else {
      // 上游明确失败：永久失败，直接 release + FAILED。
      // P0-5: 标记当前 RUNNING attempt 为 FAILED（保留失败成本记录）。
      const runningAttempt = await this.deps.attempts.findRunning(job.id);
      if (runningAttempt) {
        await this.deps.attempts.markFailed(
          runningAttempt.id,
          status.errorCode ?? 'PROVIDER_JOB_FAILED',
          status.errorMessage ?? 'Provider job failed',
          job.estimatedCostMicrousd,
        );
      }
      await this.fail(job, status.errorCode ?? 'PROVIDER_JOB_FAILED', status.errorMessage ?? 'Provider job failed');
    }
  }

  // ---- CANCEL ----

  /**
   * 取消：通知上游 cancelJob（尽力而为，不因上游失败而中止取消）+ 标记 CANCELED + 释放预留 credits。
   * 幂等：job 已是终态则跳过；finalizeCancel 与 release 使用 idempotency_key 保证只执行一次。
   * 仅 RUNNING 且已有 provider_job_id 时才需要通知上游（PENDING/QUEUED 由 API 端直接取消）。
   */
  async cancel(payload: GenerationJobPayload): Promise<void> {
    const job = await this.deps.repo.load(payload.generationJobId);
    if (!job) return;
    if (isTerminal(job.status)) return;

    if (job.status === 'RUNNING' && job.providerJobId) {
      try {
        await this.withCredential(job.provider ?? 'agnes', async (cred) => {
          const provider = await this.registry.getProvider(job.provider ?? 'agnes');
          await provider.cancelJob(job.providerJobId!, cred.secret);
        });
      } catch (err) {
        // 上游取消失败：不影响本地取消，best-effort 记录。
        this.deps.logger.warn('upstream cancel failed (best-effort)', {
          generationJobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.repo.finalizeCancelInTx(tx, { id: job.id });
      await this.deps.wallet.releaseInTx(tx, job.workspaceId, job.id, `release:cancel:${job.id}`);
    });

    this.deps.logger.info('generation job canceled & released', {
      generationJobId: job.id,
      workspaceId: job.workspaceId,
    });
  }

  // ---- IMAGE ----

  private async runImage(job: GenerationJobRow): Promise<void> {
    // P0-5: 开启 attempt 记录。
    const attempt = await this.deps.attempts.start({
      generationJobId: job.id,
      provider: job.provider ?? 'agnes',
      model: job.model ?? '',
      estimatedCostMicrousd: job.estimatedCostMicrousd,
    });

    try {
      const result = await this.withCredential(job.provider ?? 'agnes', async (cred) => {
        const provider = await this.registry.getProvider(job.provider ?? 'agnes');
        return provider.generateImage(this.buildImageInput(job), cred.secret);
      });
      await this.deps.attempts.markSucceeded(attempt.attemptId, job.estimatedCostMicrousd);
      await this.ingestAndFinalize(job, 'image', result, attempt.attemptId);
    } catch (err) {
      // P0-5: 失败 attempt 也保留成本记录。
      const providerErr = err as ProviderError;
      await this.deps.attempts.markFailed(
        attempt.attemptId,
        providerErr.category ?? 'PROVIDER_UPSTREAM_ERROR',
        err instanceof Error ? err.message : String(err),
        job.estimatedCostMicrousd,
      );
      throw err;
    }
  }

  // ---- VIDEO execute ----

  private async runVideoExecute(job: GenerationJobRow, payload: GenerationJobPayload): Promise<void> {
    // Worker-side video validation: 不信任 API 层传来的参数，在 provider 调用前再次校验。
    // 这与 entitlement.authorizeJob 中的校验互补，防止绕过 API 层直接投递的非法参数。
    const videoInput = this.buildVideoInput(job);
    const frameErr = validateVideoFrames(videoInput.numFrames, videoInput.frameRate);
    if (frameErr) {
      await this.fail(job, 'VALIDATION_ERROR', `Invalid video parameters: ${frameErr}`);
      return;
    }

    // 幂等：provider_job_id 已存在说明已提交过，不再重复提交（防重复计费）。
    let providerJobId = job.providerJobId;
    let submission: ProviderVideoSubmission | null = null;

    if (!providerJobId) {
      // P0-5: 首次提交开启 attempt。
      const attempt = await this.deps.attempts.start({
        generationJobId: job.id,
        provider: job.provider ?? 'agnes',
        model: job.model ?? '',
        estimatedCostMicrousd: job.estimatedCostMicrousd,
      });

      try {
        submission = await this.withCredential(job.provider ?? 'agnes', async (cred) => {
          const provider = await this.registry.getProvider(job.provider ?? 'agnes');
          return provider.submitVideo(this.buildVideoInput(job), cred.secret);
        });
        providerJobId = submission.providerJobId;

        // 关联 provider_job_id 到 attempt。
        await this.deps.attempts.attachProviderJobId(attempt.attemptId, providerJobId);

        const persisted = await this.deps.repo.persistProviderJob(job.id, providerJobId);
        if (!persisted) {
          // 并发下另一 Worker 已写入：以 DB 为准，不重复提交。
          const fresh = await this.deps.repo.load(job.id);
          if (fresh?.providerJobId) providerJobId = fresh.providerJobId;
        }

        // 提交成功但不结束 attempt（视频生成仍在进行，等 poll 成功后再 markSucceeded）。
      } catch (err) {
        const providerErr = err as ProviderError;
        await this.deps.attempts.markFailed(
          attempt.attemptId,
          providerErr.category ?? 'PROVIDER_UPSTREAM_ERROR',
          err instanceof Error ? err.message : String(err),
          job.estimatedCostMicrousd,
        );
        throw err;
      }
    }

    this.deps.logger.info('video submitted, scheduling poll', {
      generationJobId: job.id,
      workspaceId: job.workspaceId,
      providerJobId,
      stage: 'execute',
    });

    await this.enqueuePoll(payload, providerJobId);
  }

  // ---- poll processing ----

  private async handleVideoProcessing(job: GenerationJobRow, payload: GenerationJobPayload, progress?: number): Promise<void> {
    // 持久化真实进度到 output_json，前端通过 GET /generations/:id 读取。
    if (progress !== undefined && progress >= 0) {
      try {
        await this.deps.repo.updateProgress(job.id, progress);
      } catch {
        // best-effort: 进度更新失败不影响轮询流程。
      }
    }
    const pollCount = await this.deps.repo.incrementPoll(job.id);
    const startedAt = job.providerStartedAt ?? new Date();
    const wallElapsed = Date.now() - startedAt.getTime();

    const cfg = await this.config();
    if (pollCount >= cfg.maxPolls || wallElapsed >= cfg.maxWaitMs) {
      this.deps.logger.warn('video poll limit reached', {
        generationJobId: job.id,
        pollCount,
        wallElapsed,
      });
      await this.fail(job, 'PROVIDER_JOB_TIMEOUT', `Video poll limit reached (polls=${pollCount}, waited=${wallElapsed}ms)`);
      return;
    }

    await this.enqueuePoll(payload, job.providerJobId!);
  }

  private async enqueuePoll(payload: GenerationJobPayload, providerJobId: string): Promise<void> {
    await this.deps.queue.add(
      GENERATION_JOB_NAMES.POLL,
      {
        ...payload,
        stage: 'poll',
        providerJobId,
      },
      { delay: (await this.config()).pollIntervalMs, attempts: 1 },
    );
  }

  // ---- credential ----
  // 一次 Worker attempt 内的 provider 级 retry：对 key 特定错误（401/403/429）切换凭据。
  // 对 provider 全局错误（5xx/timeout/network）直接上抛，交给 BullMQ 整 job 重试。

  private async withCredential<T>(providerCode: string, fn: (cred: AcquiredCredential) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    const cfg = await this.config();
    for (let attempt = 0; attempt < cfg.credentialRetryAttempts; attempt++) {
      let cred: AcquiredCredential;
      try {
        cred = await this.credentials.acquire({ providerCode });
      } catch (err) {
        // 无可用 credential：transient，交给 BullMQ 重试。
        this.deps.logger.warn('no available credential', { provider: providerCode, attempt });
        throw err;
      }

      try {
        const result = await fn(cred);
        await this.credentials.markSuccess(cred.credentialId, providerCode);
        return result;
      } catch (err) {
        lastErr = err;
        const providerErr = err as ProviderError;
        if (providerErr.category === 'AUTH_ERROR' || providerErr.category === 'RATE_LIMITED') {
          // key 特定问题：标记 health 后切换下一个 credential。
          await this.credentials.markFailure(cred.credentialId, providerCode, {
            category: providerErr.category,
            retryAfterMs: providerErr.retryAfterMs,
            message: providerErr.message,
          });
          this.deps.logger.warn('credential degraded, trying next', {
            provider: providerCode,
            credentialId: cred.credentialId,
            category: providerErr.category,
            attempt,
          });
          continue;
        }
        // provider 全局错误：不换 key，直接上抛（BullMQ 重试 / permanent 处理）。
        throw err;
      } finally {
        await cred.release();
      }
    }
    // 所有 credential 都不可用：transient，交给 BullMQ。
    throw lastErr;
  }

  // ---- ingest + finalize ----

  private async ingestAndFinalize(
    job: GenerationJobRow,
    mediaType: 'image' | 'video',
    providerResult: {
      sourceUrl?: string;
      width?: number | null;
      height?: number | null;
      duration?: number | null;
    },
    attemptId?: string,
  ): Promise<void> {
    const sourceUrl = providerResult.sourceUrl;
    if (!sourceUrl) {
      await this.fail(job, 'PROVIDER_BAD_RESPONSE', 'Provider did not return a source url');
      return;
    }

    const cfg = await this.config();
    const dl = await downloadToTempFile(sourceUrl, {
      ...cfg.download,
      allowedContentTypePrefixes: cfg.allowedContentTypePrefixes,
    });
    let asset: {
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
    let displayUrl: string | null = sourceUrl;

    try {
      const stored = await this.storage.uploadFile(dl.filePath, {
        mediaType,
        contentType: dl.contentType,
        ext: mediaType === 'video' ? 'mp4' : undefined,
      });

      if (stored) {
        asset = {
          storageProvider: stored.provider,
          bucket: null, // 平台不单独追踪 bucket，object key 已含前缀
          objectKey: stored.key,
          mimeType: dl.contentType,
          size: stored.size,
          width: providerResult.width ?? null,
          height: providerResult.height ?? null,
          duration: providerResult.duration ?? null,
        };
        // 优先使用公开/CDN 稳定地址；私有 bucket 生成 presigned URL（1 小时）。
        displayUrl =
          stored.url ||
          (typeof this.storage.getDisplayUrl === 'function'
            ? await this.storage.getDisplayUrl(stored.key)
            : null) ||
          sourceUrl;
      } else {
        // 未配置对象存储（dev 'none'）：降级记录上游 URL 到 metadata，不把 provider URL 当最终 objectKey。
        asset = {
          storageProvider: 'none',
          bucket: null,
          objectKey: null,
          mimeType: dl.contentType,
          size: dl.size,
          width: providerResult.width ?? null,
          height: providerResult.height ?? null,
          duration: providerResult.duration ?? null,
          metadata: { sourceUrl },
        };
      }
    } finally {
      await cleanupTempFile(dl.filePath);
    }

    await this.finalizeSuccess(job, mediaType, asset, displayUrl, attemptId);
  }

  private async finalizeSuccess(
    job: GenerationJobRow,
    mediaType: 'image' | 'video',
    asset: {
      storageProvider: string | null;
      bucket: string | null;
      objectKey: string | null;
      mimeType: string;
      size: number;
      width?: number | null;
      height?: number | null;
      duration?: number | null;
      metadata?: Record<string, unknown>;
    },
    displayUrl: string | null,
    attemptId?: string,
  ): Promise<void> {
    // MVP pricing policy：Provider 未返回足够信息计算真实成本，按保留额度结算。
    // 这不是临时 TODO，而是第一版明确的定价策略；后续可接入真实 Pricing 计算 actualCredits。
    const actualCredits = job.reservedCredits;
    // 供应商成本：P0-4 优先使用 job 上的 estimatedCostMicrousd（来自 PriceQuote 快照），
    // 兼容旧 pricing_rules.pricingJson.providerCostUsd 字段（微美元），缺省 0 不伪造。
    const legacyProviderCostUsd = await this.deps.repo.providerCostUsd(job.type, job.provider ?? 'agnes', job.model ?? '');
    const estimatedCostMicrousd = job.estimatedCostMicrousd || legacyProviderCostUsd || 0;
    // 当前 Provider 未回报真实账单成本：cost_status = ESTIMATED，reported=0。
    // P0 红队修复：final_cost_microusd 只有在成本真正"最终化"（REPORTED/RECONCILED）时才能写入。
    // 禁止把静态估值写进 final_cost（否则 final 字段语义虚假，且无法区分"尚未对账"与"已确认"）。
    const reportedCostMicrousd = 0;
    const finalCostMicrousd = 0;
    const costStatus = 'ESTIMATED' as const;

    await this.deps.db.transaction(async (tx) => {
      await this.deps.repo.finalizeSuccessInTx(tx, {
        workspaceId: job.workspaceId,
        userId: job.userId,
        generationJobId: job.id,
        type: job.type,
        provider: job.provider ?? 'agnes',
        model: job.model ?? '',
        asset: {
          mediaType,
          storageProvider: asset.storageProvider,
          bucket: asset.bucket,
          objectKey: asset.objectKey,
          mimeType: asset.mimeType,
          size: asset.size,
          width: asset.width ?? null,
          height: asset.height ?? null,
          duration: asset.duration ?? null,
          metadata: asset.metadata,
        },
        usage: {
          duration: mediaType === 'video' ? asset.duration ?? null : null,
          resolution: this.resolution(job),
          providerCostUsd: legacyProviderCostUsd,
          creditsCharged: actualCredits,
          metadata: { provider: job.provider ?? 'agnes', model: job.model ?? '' },
        },
        actualCredits,
        // P0-4: 明确成本语义，保证 Job 与 UsageEvent 一致。
        estimatedCostMicrousd,
        reportedCostMicrousd,
        finalCostMicrousd,
        costStatus,
        output: {
          url: displayUrl,
          width: asset.width ?? null,
          height: asset.height ?? null,
          duration: mediaType === 'video' ? asset.duration ?? null : null,
          mimeType: asset.mimeType,
          storageProvider: asset.storageProvider,
        },
      });
      // settle 幂等（idempotency_key），与 asset/usage/job 状态同事务提交。
      await this.deps.wallet.settleInTx(
        tx,
        job.workspaceId,
        job.id,
        actualCredits,
        `settle:${job.id}`,
      );
    });

    // P1-1: 成功任务写 append-only CostEvent（ESTIMATED，幂等）。Provider 未回报真实账单，
    // 因此只记录 ESTIMATED，不伪造 REPORTED/RECONCILED。后续经 provider 账单/对账升级为 REPORTED。
    // 采用 best-effort：成本入账是 append-only 分析/审计侧效应，绝不能因它失败而回滚/重试
    // 已经（在事务内）settle 成功的生成结果。失败仅告警，交由对账/递补补录。
    if (estimatedCostMicrousd > 0) {
      try {
        const eventKey = attemptId
          ? generateCostEventKey({ generationJobId: job.id, attemptId, status: 'ESTIMATED' })
          : `genjob:${job.id}:final:estimated`;
        await new CostRevenueLedger(this.deps.db).insertCostEvent({
          eventKey,
          workspaceId: job.workspaceId,
          userId: job.userId,
          generationJobId: job.id,
          generationAttemptId: attemptId ?? null,
          costType: job.type === 'VIDEO' ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION',
          provider: job.provider ?? 'agnes',
          model: job.model ?? '',
          quantity: 1,
          unit: mediaType === 'video' ? 'seconds' : 'image',
          unitCostMicrousd: estimatedCostMicrousd,
          totalCostMicrousd: estimatedCostMicrousd,
          status: 'ESTIMATED',
          metadata: { costStatus },
        });
      } catch (err) {
        this.deps.logger.warn('failed to record cost event (best-effort)', {
          generationJobId: job.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.deps.logger.info('generation job succeeded & settled', {
      generationJobId: job.id,
      workspaceId: job.workspaceId,
      actualCredits,
      estimatedCostMicrousd,
      costStatus,
    });
  }

  private async fail(job: GenerationJobRow, errorCode: string, errorMessage: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await this.deps.repo.finalizeFailureInTx(tx, { id: job.id, errorCode, errorMessage });
      await this.deps.wallet.releaseInTx(tx, job.workspaceId, job.id, `release:fail:${job.id}`);
    });
    this.deps.logger.error('generation job permanently failed & released', {
      generationJobId: job.id,
      workspaceId: job.workspaceId,
      errorCode,
    });
  }

  // ---- input mappers ----

  private buildImageInput(job: GenerationJobRow): GenerateImageInput {
    const input = job.inputJson ?? {};
    return {
      model: job.model ?? '',
      prompt: String(input.prompt ?? ''),
      size: typeof input.size === 'string' ? input.size : undefined,
      ratio: typeof input.ratio === 'string' ? input.ratio : undefined,
      mode: (input.mode as GenerateImageInput['mode']) ?? 'text2img',
      images: Array.isArray(input.images) ? (input.images as string[]) : undefined,
      responseFormat: (input.responseFormat as GenerateImageInput['responseFormat']) ?? 'url',
    };
  }

  private buildVideoInput(job: GenerationJobRow): GenerateVideoInput {
    const input = job.inputJson ?? {};
    return {
      model: job.model ?? '',
      prompt: String(input.prompt ?? ''),
      negativePrompt: typeof input.negativePrompt === 'string' ? input.negativePrompt : undefined,
      mode: (input.mode as GenerateVideoInput['mode']) ?? 'text2video',
      width: Number(input.width ?? 1280),
      height: Number(input.height ?? 720),
      numFrames: Number(input.numFrames ?? 16),
      frameRate: Number(input.frameRate ?? 30),
      images: Array.isArray(input.images) ? (input.images as string[]) : undefined,
      image: typeof input.image === 'string' ? input.image : undefined,
      seed: typeof input.seed === 'number' ? input.seed : undefined,
      numInferenceSteps: typeof input.numInferenceSteps === 'number' ? input.numInferenceSteps : undefined,
    };
  }

  private resolution(job: GenerationJobRow): string | null {
    const input = job.inputJson ?? {};
    const w = input.width ? Number(input.width) : undefined;
    const h = input.height ? Number(input.height) : undefined;
    return w && h ? `${w}x${h}` : null;
  }
}

export { QUEUES };