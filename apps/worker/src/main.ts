import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@enova/config';
import { QUEUES, type GenerationJobPayload } from '@enova/contracts';
import { createDb, providers, SettingsStore, type Database } from '@enova/db';
import { WalletGateway } from '@enova/billing';
import {
  CredentialCrypto,
  ProviderRegistry,
  RedisCredentialManager,
  createObjectStorage,
  type UrlGuardOptions,
} from '@enova/provider';
import { WorkerLogger } from './logger.js';
import { GenerationRepo } from './generation/repo.js';
import { GenerationPipeline } from './generation/pipeline.js';
import { processGenerationPayload } from './processors/generation.processor.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = new WorkerLogger('enova-worker');

  const db: Database = createDb(env.DATABASE_URL);

  // 单独连接池，避免与 Producer 共享连接数。
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  // ---- Provider / Credential / Storage ----
  const crypto = CredentialCrypto.fromEnv(env.CREDENTIAL_MASTER_KEY);
  // 动态配置：环境变量兜底 + 管理员后台 DB 覆盖（启动时读取，改配置后重启 Worker 生效）。
  const settings = new SettingsStore(db, env, crypto);
  const cfgGetNum = async (key: string, fallback: number): Promise<number> =>
    (await settings.getNumber(key)) ?? fallback;
  const cfgGetBool = async (key: string, fallback: boolean): Promise<boolean> =>
    (await settings.getBoolean(key)) ?? fallback;
  const cfgGetStr = async (key: string, fallback: string): Promise<string> =>
    (await settings.getString(key)) ?? fallback;

  const pollIntervalMs = await cfgGetNum('video.pollIntervalMs', env.VIDEO_POLL_INTERVAL_MS);
  const maxPolls = await cfgGetNum('video.maxPolls', env.VIDEO_MAX_POLLS);
  const maxWaitMs = await cfgGetNum('video.maxWaitMs', env.VIDEO_MAX_WAIT_MS);
  const credentialRetryAttempts = await cfgGetNum('credential.retryAttempts', env.CREDENTIAL_RETRY_ATTEMPTS);
  const credentialLeaseTtlMs = await cfgGetNum('credential.leaseTtlMs', env.CREDENTIAL_LEASE_TTL_MS);
  const providerHttpTimeoutMs = await cfgGetNum('provider.httpTimeoutMs', env.PROVIDER_HTTP_TIMEOUT_MS);
  const storageMaxBytes = await cfgGetNum('storage.maxBytes', env.STORAGE_MAX_BYTES);
  const storageDownloadTimeoutMs = await cfgGetNum('storage.downloadTimeoutMs', env.STORAGE_DOWNLOAD_TIMEOUT_MS);
  const allowedContentTypes = await cfgGetStr('storage.allowedContentTypes', env.STORAGE_ALLOWED_CONTENT_TYPES);
  const ssrfAllowHttp = await cfgGetBool('ssrf.allowHttp', env.SSRF_ALLOW_HTTP);
  const ssrfDevAllowList = await cfgGetStr('ssrf.devAllowList', env.SSRF_DEV_ALLOW_LIST);
  const ssrfResolveDns = await cfgGetBool('ssrf.resolveDns', env.SSRF_RESOLVE_DNS);

  // ---- SSRF guard（base_url 与上游下载 URL 校验） ----
  const guard: UrlGuardOptions = {
    allowHttp: ssrfAllowHttp,
    resolveDns: ssrfResolveDns,
    devAllowlist: env.NODE_ENV !== 'production' ? ssrfDevAllowList.split(',').map((s) => s.trim()).filter(Boolean) : [],
  };

  const credentials = new RedisCredentialManager({ db, redis: connection, crypto, leaseTtlMs: credentialLeaseTtlMs });
  const registry = new ProviderRegistry({
    loadProvider: async (code) => {
      const rows = await db
        .select({ code: providers.code, name: providers.name, baseUrl: providers.baseUrl, status: providers.status, config: providers.config })
        .from(providers)
        .where(eq(providers.code, code))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { code: row.code, name: row.name, baseUrl: row.baseUrl, status: row.status, config: row.config ?? undefined };
    },
    guard,
    timeoutMs: providerHttpTimeoutMs,
  });
  const storage = createObjectStorage(
    env.STORAGE_PROVIDER === 's3'
      ? { kind: 's3', s3: {
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          prefix: env.S3_PREFIX,
          publicBaseUrl: env.S3_PUBLIC_BASE_URL,
          endpointUrl: env.S3_ENDPOINT_URL,
          credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } : undefined,
          download: { guard, maxBytes: storageMaxBytes, timeoutMs: storageDownloadTimeoutMs },
          allowedContentTypePrefixes: allowedContentTypes.split(','),
        } }
      : { kind: 'none' },
  );

  const repo = new GenerationRepo(db);
  const wallet = new WalletGateway(db);
  // Worker 侧生产者：用于视频延迟轮询（pipeline.enqueuePoll）。
  const queue = new Queue(QUEUES.GENERATION, { connection, prefix: env.BULLMQ_PREFIX });
  const pipeline = new GenerationPipeline({
    db,
    repo,
    registry,
    credentials,
    storage,
    wallet,
    queue,
    logger,
    config: {
      pollIntervalMs,
      maxPolls,
      maxWaitMs,
      credentialRetryAttempts,
      download: { guard, maxBytes: storageMaxBytes, timeoutMs: storageDownloadTimeoutMs },
      allowedContentTypePrefixes: allowedContentTypes.split(','),
    },
  });

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
      concurrency: env.BULLMQ_CONCURRENCY,
      prefix: env.BULLMQ_PREFIX,
      // attempts/backoff 由 API 侧 Queue.defaultJobOptions 控制（transient 失败按指数退避重试，
      // 耗尽后由本 Worker 的 failed handler release credits）。
    },
  );

  worker.on('ready', () => logger.info('generation worker ready'));
  worker.on('error', (err) => logger.error('generation worker error', {}, err));
  worker.on('failed', async (job, err) => {
    const payload = job?.data as GenerationJobPayload | undefined;
    const fields = { generationJobId: payload?.generationJobId, workspaceId: payload?.workspaceId };
    logger.error('generation job final failed', fields, err);

    if (!payload) return;
    // 最终失败（重试耗尽）：释放该 Job 预留的 credits 并标记 FAILED。
    // WalletGateway.release 幂等（idempotencyKey），重试/重复事件不会重复退款。
    try {
      await wallet.release(payload.workspaceId, payload.generationJobId, `release:fail:${payload.generationJobId}`);
      await db.transaction((tx) =>
        repo.finalizeFailureInTx(tx, {
          id: payload.generationJobId,
          errorCode: (err as Error & { code?: string }).code ?? 'PROVIDER_UPSTREAM_ERROR',
          errorMessage: err instanceof Error ? err.message : String(err),
        }),
      );
      logger.info('released reserved credits on final failure', fields);
    } catch (releaseErr) {
      // 释放失败不能静默：记录并保留 job 状态，便于人工介入。
      logger.error('failed to release credits on job failure', fields, releaseErr);
    }
  });

  logger.info('worker started', {
    queue: QUEUES.GENERATION,
    concurrency: env.BULLMQ_CONCURRENCY,
    attempts: env.BULLMQ_JOB_ATTEMPTS,
    redis: env.REDIS_URL,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('worker shutting down', { signal });
    await worker.close();
    await queue.close();
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