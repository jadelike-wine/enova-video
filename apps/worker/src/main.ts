import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { loadEnv } from '@enova/config';
import { QUEUES, type GenerationJobPayload } from '@enova/contracts';
import { createDb, type Database } from '@enova/db';
import { WalletGateway } from '@enova/billing';
import { CredentialCrypto } from '@enova/provider';
import { WorkerLogger } from './logger.js';
import { GenerationAttemptsRepo } from './generation/attempts.repo.js';
import { GenerationRepo } from './generation/repo.js';
import { GenerationPipeline, type GenerationPipelineConfig, type PipelineResourceProvider } from './generation/pipeline.js';
import { processGenerationPayload } from './processors/generation.processor.js';
import { WorkerSettings } from './worker-settings.js';
import { WorkerResources } from './worker-resources.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = new WorkerLogger('enova-worker');

  const db: Database = createDb(env.DATABASE_URL);

  // 单独连接池，避免与 Producer 共享连接数。
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  // ---- 动态配置（DB 覆盖 + env 兜底 + Redis pub/sub 实时失效）----
  const crypto = CredentialCrypto.fromEnv(env.CREDENTIAL_MASTER_KEY);

  // Forward reference：WorkerSettings.onInvalidate 需要 WorkerResources.rebuild，
  // WorkerResources 需要 WorkerSettings 读取配置。用 mutable holder 打破循环。
  const resourcesHolder: { current: WorkerResources | undefined } = { current: undefined };

  const settings = new WorkerSettings({
    db,
    env,
    crypto,
    redis: connection,
    logger,
    onInvalidate: (changedKeys) => {
      // 配置变更 → 重建 storage/registry/credentials（异步，不阻塞 pub/sub）。
      if (resourcesHolder.current) {
        void resourcesHolder.current.rebuild(changedKeys).catch((err) => {
          logger.error('worker resources rebuild failed', { keys: changedKeys.join(',') }, err);
        });
      }
    },
  });

  const resources = new WorkerResources({ db, redis: connection, crypto, settings, env, logger });
  resourcesHolder.current = resources;

  // 首次启动：迁移 legacy env → DB（幂等），然后初始化资源。
  const migrated = await settings.migrateFromEnv();
  if (migrated.length > 0) {
    logger.info('migrated legacy env vars to DB', { keys: migrated.join(',') });
  }
  // 应用 DB 日志配置（Bootstrap 阶段用 env/default，启动后覆盖为 DB 配置）。
  await settings.applyLogSettings();
  await resources.init();

  // PipelineResourceProvider：pipeline 通过此接口获取动态配置和可热替换的资源。
  const resourceProvider: PipelineResourceProvider & {
    getConfig(): Promise<GenerationPipelineConfig>;
  } = {
    get storage() {
      return resources.storage;
    },
    get registry() {
      return resources.registry;
    },
    get credentials() {
      return resources.credentials;
    },
    async getConfig(): Promise<GenerationPipelineConfig> {
      const cfg = await settings.getPipelineConfig({
        VIDEO_POLL_INTERVAL_MS: env.VIDEO_POLL_INTERVAL_MS,
        VIDEO_MAX_POLLS: env.VIDEO_MAX_POLLS,
        VIDEO_MAX_WAIT_MS: env.VIDEO_MAX_WAIT_MS,
        CREDENTIAL_RETRY_ATTEMPTS: env.CREDENTIAL_RETRY_ATTEMPTS,
        CREDENTIAL_LEASE_TTL_MS: env.CREDENTIAL_LEASE_TTL_MS,
        PROVIDER_HTTP_TIMEOUT_MS: env.PROVIDER_HTTP_TIMEOUT_MS,
        STORAGE_MAX_BYTES: env.STORAGE_MAX_BYTES,
        STORAGE_DOWNLOAD_TIMEOUT_MS: env.STORAGE_DOWNLOAD_TIMEOUT_MS,
        STORAGE_ALLOWED_CONTENT_TYPES: env.STORAGE_ALLOWED_CONTENT_TYPES,
        SSRF_ALLOW_HTTP: env.SSRF_ALLOW_HTTP,
        SSRF_DEV_ALLOW_LIST: env.SSRF_DEV_ALLOW_LIST,
        SSRF_RESOLVE_DNS: env.SSRF_RESOLVE_DNS,
        NODE_ENV: env.NODE_ENV,
      });
      return {
        pollIntervalMs: cfg.pollIntervalMs,
        maxPolls: cfg.maxPolls,
        maxWaitMs: cfg.maxWaitMs,
        credentialRetryAttempts: cfg.credentialRetryAttempts,
        download: cfg.download,
        allowedContentTypePrefixes: cfg.allowedContentTypePrefixes,
      };
    },
  };

  const repo = new GenerationRepo(db);
  const attempts = new GenerationAttemptsRepo(db);
  const wallet = new WalletGateway(db);
  // Worker 侧生产者：用于视频延迟轮询（pipeline.enqueuePoll）。
  const queue = new Queue(QUEUES.GENERATION, { connection, prefix: env.BULLMQ_PREFIX });
  const pipeline = new GenerationPipeline({
    db,
    repo,
    attempts,
    resources: resourceProvider,
    wallet,
    queue,
    logger,
  });

  // queue.workerConcurrency 仍为 restartRequired：BullMQ Worker concurrency 在构造时固定，
  // 动态修改需要重启 Worker 进程。管理员后台修改此配置时会看到 restartRequired 标记。
  // 优先级：DB explicit > legacy BULLMQ_CONCURRENCY env > registry default。
  const workerConcurrency = (await settings.getNumber('queue.workerConcurrency')) ?? env.BULLMQ_CONCURRENCY;
  const worker = new Worker(
    QUEUES.GENERATION,
    async (job) => {
      const started = Date.now();
      const payload = job.data;
      try {
        await processGenerationPayload(pipeline, payload);
        logger.info('generation job processing finished', {
          generationJobId: payload.generationJobId,
          stage: payload.stage,
          duration: Date.now() - started,
        });
      } catch (err) {
        logger.error('generation job processing failed', {
          generationJobId: payload.generationJobId,
          stage: payload.stage,
          duration: Date.now() - started,
        }, err);
        throw err;
      }
    },
    {
      connection,
      concurrency: workerConcurrency,
      prefix: env.BULLMQ_PREFIX,
      // attempts/backoff 由 API 侧 Queue.add() 时从动态配置读取并传入每个 job。
    },
  );

  worker.on('ready', () => logger.info('generation worker ready'));
  worker.on('error', (err) => logger.error('generation worker error', {}, err));
  worker.on('failed', async (job, err) => {
    const payload = job?.data as GenerationJobPayload | undefined;
    const fields = { generationJobId: payload?.generationJobId, workspaceId: payload?.workspaceId };
    logger.error('generation job final failed', fields, err);

    if (!payload) return;
    // 最终失败（重试耗尽）：在同一个事务内释放该 Job 预留的 credits 并标记 FAILED。
    // 原实现分两步（先 release 再 finalizeFailure）在两步之间崩溃会把 credits 释放掉但
    // job 仍停留在 RUNNING/QUEUED，造成 reserved_balance 漂移的孤儿状态。
    // WalletGateway.releaseInTx 幂等（idempotencyKey），重复事件不会重复退款。
    try {
      await db.transaction(async (tx) => {
        await wallet.releaseInTx(tx, payload.workspaceId, payload.generationJobId, `release:fail:${payload.generationJobId}`);
        await repo.finalizeFailureInTx(tx, {
          id: payload.generationJobId,
          errorCode: (err as Error & { code?: string }).code ?? 'PROVIDER_UPSTREAM_ERROR',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
      logger.info('released reserved credits on final failure', fields);
    } catch (releaseErr) {
      // 释放失败不能静默：记录并保留 job 状态，便于人工介入。
      logger.error('failed to release credits on job failure', fields, releaseErr);
    }
  });

  logger.info('worker started', {
    queue: QUEUES.GENERATION,
    concurrency: workerConcurrency,
    redis: env.REDIS_URL,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('worker shutting down', { signal });
    await worker.close();
    await queue.close();
    await settings.close();
    await connection.quit();
    await db.$client.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((err) => {
  // 启动失败：输出到 stderr 后退出。
  console.error('worker failed to start', err);
  process.exit(1);
});
