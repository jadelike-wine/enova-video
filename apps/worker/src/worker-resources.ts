/**
 * Worker 运行时资源持有者：storage / registry / credentials 可在配置变更后热重建。
 *
 * WorkerSettings 的 onInvalidate 回调检测到 storage/SSRF/provider 相关配置变更时，
 * 调用 rebuild() 重建这些对象。Pipeline 通过 getter 访问最新实例。
 */

import { eq } from 'drizzle-orm';
import { providers, type Database } from '@enova/db';
import {
  ProviderRegistry,
  RedisCredentialManager,
  createObjectStorage,
  type CredentialCrypto,
  type ObjectStorage,
  type CredentialManager,
} from '@enova/provider';
import type { WorkerSettings, StorageRuntimeConfig } from './worker-settings.js';
import { WorkerLogger } from './logger.js';

export interface WorkerResourceHolder {
  storage: ObjectStorage;
  registry: ProviderRegistry;
  credentials: CredentialManager;
  storageConfig: StorageRuntimeConfig;
}

export interface WorkerResourcesDeps {
  db: Database;
  redis: import('ioredis').default;
  crypto: CredentialCrypto;
  settings: WorkerSettings;
  logger: WorkerLogger;
  env: Record<string, unknown>;
}

export class WorkerResources {
  private holder: WorkerResourceHolder | null = null;
  private readonly deps: WorkerResourcesDeps;

  /** 并发 rebuild 保护：同一时间最多一个 rebuild 在执行。 */
  private rebuildPromise: Promise<void> | null = null;
  /** rebuild 期间收到的新 invalidation 不丢失。 */
  private dirty = false;
  /** 合并的 changedKeys。 */
  private pendingKeys = new Set<string>();

  constructor(deps: WorkerResourcesDeps) {
    this.deps = deps;
  }

  /** 首次启动：异步初始化资源。 */
  async init(): Promise<void> {
    await this.rebuild([]);
  }

  /**
   * 重建 storage / registry / credentials（配置变更后调用）。
   * changedKeys 为空表示首次初始化。
   *
   * 并发安全：同一时间最多一个 rebuild 在执行；rebuild 期间的新 invalidation
   * 会被合并到 pendingKeys，当前 rebuild 完成后自动再执行一次最新 rebuild。
   * 最终保证最新配置胜出。
   */
  async rebuild(changedKeys: string[]): Promise<void> {
    // 合并 changedKeys 到 pendingKeys
    for (const k of changedKeys) this.pendingKeys.add(k);

    // 如果已有 rebuild 正在执行，标记 dirty 并等待当前 rebuild 完成后再触发。
    if (this.rebuildPromise) {
      this.dirty = true;
      // 等待当前 rebuild 完成；如果当前 rebuild 发现 dirty，会自动再重建。
      await this.rebuildPromise;
      return;
    }

    this.rebuildPromise = this.doRebuild();
    try {
      await this.rebuildPromise;
    } finally {
      this.rebuildPromise = null;
    }

    // 如果 rebuild 期间有新 invalidation 到达，再执行一次最新 rebuild。
    if (this.dirty) {
      this.dirty = false;
      await this.rebuild([]);
    }
  }

  private async doRebuild(): Promise<void> {
    const keys = [...this.pendingKeys];
    this.pendingKeys.clear();
    const env = this.deps.env as Record<string, string | number | boolean>;

    try {
      const storageConfig = await this.deps.settings.getStorageConfig({
        STORAGE_PROVIDER: String(env.STORAGE_PROVIDER ?? 'aws_s3'),
        AWS_REGION: String(env.AWS_REGION ?? 'ap-southeast-1'),
        AWS_S3_BUCKET: String(env.AWS_S3_BUCKET ?? ''),
        AWS_S3_PREFIX: String(env.AWS_S3_PREFIX ?? 'agnes-ai'),
        AWS_S3_PUBLIC_BASE_URL: String(env.AWS_S3_PUBLIC_BASE_URL ?? ''),
        AWS_S3_ENDPOINT_URL: String(env.AWS_S3_ENDPOINT_URL ?? ''),
        AWS_ACCESS_KEY_ID: String(env.AWS_ACCESS_KEY_ID ?? ''),
        AWS_SECRET_ACCESS_KEY: String(env.AWS_SECRET_ACCESS_KEY ?? ''),
        AWS_SESSION_TOKEN: String(env.AWS_SESSION_TOKEN ?? ''),
        QINIU_ACCESS_KEY: String(env.QINIU_ACCESS_KEY ?? ''),
        QINIU_SECRET_KEY: String(env.QINIU_SECRET_KEY ?? ''),
        QINIU_BUCKET: String(env.QINIU_BUCKET ?? ''),
        QINIU_DOMAIN: String(env.QINIU_DOMAIN ?? ''),
        QINIU_REGION: String(env.QINIU_REGION ?? 'z0'),
        STORAGE_MAX_BYTES: Number(env.STORAGE_MAX_BYTES ?? 536870912),
        STORAGE_DOWNLOAD_TIMEOUT_MS: Number(env.STORAGE_DOWNLOAD_TIMEOUT_MS ?? 120000),
        STORAGE_ALLOWED_CONTENT_TYPES: String(env.STORAGE_ALLOWED_CONTENT_TYPES ?? 'image/,video/'),
        SSRF_ALLOW_HTTP: Boolean(env.SSRF_ALLOW_HTTP),
        SSRF_DEV_ALLOW_LIST: String(env.SSRF_DEV_ALLOW_LIST ?? ''),
        SSRF_RESOLVE_DNS: env.SSRF_RESOLVE_DNS !== false,
        NODE_ENV: String(env.NODE_ENV ?? 'development'),
      });

    // 未配置完整时使用 none 保持进程可运行，后台测试接口会提示具体缺失项。
    if (storageConfig.provider !== 'none' && !storageConfig.configured) {
      this.deps.logger.warn('object storage is not configured; using none storage', {
        provider: storageConfig.provider,
        message: '请配置对象存储',
      });
    }
    const newStorage = createObjectStorage(
      storageConfig.provider === 'aws_s3' && storageConfig.configured
        ? {
            kind: 'aws_s3',
            s3: {
              region: storageConfig.region,
              bucket: storageConfig.bucket,
              prefix: storageConfig.prefix,
              publicBaseUrl: storageConfig.publicBaseUrl,
              endpointUrl: storageConfig.endpointUrl,
              credentials: storageConfig.credentials,
              download: {
                guard: storageConfig.guard,
                maxBytes: storageConfig.maxBytes,
                timeoutMs: storageConfig.downloadTimeoutMs,
              },
              allowedContentTypePrefixes: storageConfig.allowedContentTypePrefixes,
            },
          }
        : storageConfig.provider === 'qiniu' && storageConfig.configured
        ? {
            kind: 'qiniu',
            qiniu: {
              accessKey: storageConfig.qiniu.accessKey,
              secretKey: storageConfig.qiniu.secretKey,
              bucket: storageConfig.qiniu.bucket,
              domain: storageConfig.qiniu.domain,
              region: storageConfig.qiniu.region,
              prefix: storageConfig.prefix,
              download: {
                guard: storageConfig.guard,
                maxBytes: storageConfig.maxBytes,
                timeoutMs: storageConfig.downloadTimeoutMs,
              },
              allowedContentTypePrefixes: storageConfig.allowedContentTypePrefixes,
            },
          }
        : { kind: 'none' },
    );

    const providerHttpTimeoutMs = (await this.deps.settings.getNumber('provider.httpTimeoutMs')) ??
      Number(env.PROVIDER_HTTP_TIMEOUT_MS ?? 120000);
    const credentialLeaseTtlMs = (await this.deps.settings.getNumber('credential.leaseTtlMs')) ??
      Number(env.CREDENTIAL_LEASE_TTL_MS ?? 120000);

    const newCredentials = new RedisCredentialManager({
      db: this.deps.db,
      redis: this.deps.redis,
      crypto: this.deps.crypto,
      leaseTtlMs: credentialLeaseTtlMs,
    });

    const newRegistry = new ProviderRegistry({
      loadProvider: async (code) => {
        const rows = await this.deps.db
          .select({
            code: providers.code,
            name: providers.name,
            baseUrl: providers.baseUrl,
            status: providers.status,
            config: providers.config,
          })
          .from(providers)
          .where(eq(providers.code, code))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        return {
          code: row.code,
          name: row.name,
          baseUrl: row.baseUrl,
          status: row.status,
          config: row.config ?? undefined,
        };
      },
      guard: storageConfig.guard,
      timeoutMs: providerHttpTimeoutMs,
    });

    // 全部构建成功后再原子 swap（旧 → 新）。
    this.holder = { storage: newStorage, registry: newRegistry, credentials: newCredentials, storageConfig };

    if (keys.length > 0) {
      this.deps.logger.info('worker resources rebuilt after settings change', { changedKeys: keys.join(',') });
    }
    } catch (err) {
      // 构建新资源失败：保留旧 resource，不设 undefined，不泄漏 Secret。
      this.deps.logger.error('worker resources rebuild failed, keeping old resources', {
        keys: keys.join(','),
      }, err instanceof Error ? err : undefined);
      // 不 rethrow：后续 invalidation 或下次 new keys 到达时重试 rebuild。
    }
  }

  get storage(): ObjectStorage {
    if (!this.holder) throw new Error('WorkerResources not initialized: call init() first');
    return this.holder.storage;
  }

  get registry(): ProviderRegistry {
    if (!this.holder) throw new Error('WorkerResources not initialized: call init() first');
    return this.holder.registry;
  }

  get credentials(): CredentialManager {
    if (!this.holder) throw new Error('WorkerResources not initialized: call init() first');
    return this.holder.credentials;
  }

  get storageConfig(): StorageRuntimeConfig {
    if (!this.holder) throw new Error('WorkerResources not initialized: call init() first');
    return this.holder.storageConfig;
  }
}
