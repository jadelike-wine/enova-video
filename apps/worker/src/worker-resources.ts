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
      STORAGE_PROVIDER: String(env.STORAGE_PROVIDER ?? 'none'),
      S3_REGION: String(env.S3_REGION ?? ''),
      S3_BUCKET: String(env.S3_BUCKET ?? ''),
      S3_PREFIX: String(env.S3_PREFIX ?? 'enova'),
      S3_PUBLIC_BASE_URL: String(env.S3_PUBLIC_BASE_URL ?? ''),
      S3_ENDPOINT_URL: String(env.S3_ENDPOINT_URL ?? ''),
      S3_ACCESS_KEY: String(env.S3_ACCESS_KEY ?? ''),
      S3_SECRET_KEY: String(env.S3_SECRET_KEY ?? ''),
      STORAGE_MAX_BYTES: Number(env.STORAGE_MAX_BYTES ?? 536870912),
      STORAGE_DOWNLOAD_TIMEOUT_MS: Number(env.STORAGE_DOWNLOAD_TIMEOUT_MS ?? 120000),
      STORAGE_ALLOWED_CONTENT_TYPES: String(env.STORAGE_ALLOWED_CONTENT_TYPES ?? 'image/,video/'),
      SSRF_ALLOW_HTTP: Boolean(env.SSRF_ALLOW_HTTP),
      SSRF_DEV_ALLOW_LIST: String(env.SSRF_DEV_ALLOW_LIST ?? ''),
      SSRF_RESOLVE_DNS: env.SSRF_RESOLVE_DNS !== false,
      NODE_ENV: String(env.NODE_ENV ?? 'development'),
    });

    // 先完整构建新资源，成功后再 swap（失败保留旧资源，不泄漏 Secret）。
    const newStorage = createObjectStorage(
      storageConfig.provider === 's3'
        ? {
            kind: 's3',
            s3: {
              region: storageConfig.s3Region,
              bucket: storageConfig.s3Bucket,
              prefix: storageConfig.s3Prefix,
              publicBaseUrl: storageConfig.s3PublicBaseUrl,
              endpointUrl: storageConfig.s3EndpointUrl,
              credentials: storageConfig.s3AccessKey
                ? { accessKeyId: storageConfig.s3AccessKey, secretAccessKey: storageConfig.s3SecretKey! }
                : undefined,
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
