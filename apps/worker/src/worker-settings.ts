/**
 * Worker 动态配置缓存（跨进程实时生效）：
 *
 * - DB 是 source of truth（通过共享的 SettingsStore 读取）。
 * - 本地内存缓存避免每次 job 都查 DB（TTL 30s 兜底，pub/sub 即时失效）。
 * - 订阅 Redis pub/sub SETTINGS_INVALIDATION_CHANNEL：管理员在 API 修改配置后，
 *   所有 Worker 实例立即清除缓存，下次读取获取新值。
 * - 对 storage / SSRF guard 等需要重建对象的配置，提供 onInvalidate 回调，
 *   Worker main.ts 可据此重建 ObjectStorage / ProviderRegistry。
 *
 * 不缓存 Secret 明文：getSecret() 每次走 DB（频率低，且避免明文常驻内存）。
 */

import IORedis from 'ioredis';
import type { Database } from '@enova/db';
import {
  SettingsStore,
  RedisSettingsInvalidator,
  createSettingsInvalidationHandler,
  SETTINGS_INVALIDATION_CHANNEL,
  type SettingsCrypto,
} from '@enova/db';
import { resolveStorageConfig, type ResolvedStorageConfig, type StorageEnvironment, type UrlGuardOptions } from '@enova/provider';
import { WorkerLogger } from './logger.js';

/** 缓存 TTL（毫秒）：pub/sub 失败时最终一致的兜底。 */
const CACHE_TTL_MS = 30_000;

export interface WorkerSettingsDeps {
  db: Database;
  env: Record<string, unknown>;
  crypto?: SettingsCrypto;
  redis: IORedis;
  logger: WorkerLogger;
  /** 配置变更回调（如重建 ObjectStorage / ProviderRegistry）。 */
  onInvalidate?: (changedKeys: string[]) => void;
}

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

export interface StorageRuntimeConfig extends ResolvedStorageConfig {
  /** SSRF guard（base_url 与上游下载 URL 校验）。 */
  guard: UrlGuardOptions;
  maxBytes: number;
  downloadTimeoutMs: number;
  allowedContentTypePrefixes: string[];
}

export interface PipelineRuntimeConfig {
  pollIntervalMs: number;
  maxPolls: number;
  maxWaitMs: number;
  credentialRetryAttempts: number;
  credentialLeaseTtlMs: number;
  providerHttpTimeoutMs: number;
  download: {
    guard: UrlGuardOptions;
    maxBytes: number;
    timeoutMs: number;
  };
  allowedContentTypePrefixes: string[];
}

/** 需要触发 storage/registry 重建的配置 key 集合。 */
const STORAGE_REBUILD_KEYS = new Set([
  'storage.provider',
  'storage.awsRegion', 'storage.awsS3Bucket', 'storage.awsS3Prefix', 'storage.awsS3PublicBaseUrl', 'storage.awsS3EndpointUrl',
  'storage.awsAccessKeyId', 'storage.awsSecretAccessKey', 'storage.awsSessionToken',
  'storage.qiniuAccessKey', 'storage.qiniuSecretKey', 'storage.qiniuBucket', 'storage.qiniuDomain', 'storage.qiniuRegion',
  'storage.maxBytes', 'storage.downloadTimeoutMs', 'storage.allowedContentTypes',
  'ssrf.allowHttp', 'ssrf.devAllowList', 'ssrf.resolveDns',
  'provider.httpTimeoutMs',
  'credential.leaseTtlMs',
]);

/** 需要热更新 logger 的配置 key 集合。 */
const LOG_RELOAD_KEYS = new Set(['log.level', 'log.format']);

export class WorkerSettings {
  private readonly store: SettingsStore;
  private readonly subscriber: IORedis;
  private readonly logger: WorkerLogger;
  private readonly onInvalidate?: (changedKeys: string[]) => void;
  private readonly cache = new Map<string, CacheEntry>();
  private closed = false;

  constructor(deps: WorkerSettingsDeps) {
    const invalidator = new RedisSettingsInvalidator(deps.redis);
    this.store = new SettingsStore(deps.db, deps.env, deps.crypto, invalidator);
    this.logger = deps.logger;
    this.onInvalidate = deps.onInvalidate;

    // 订阅失效频道：收到广播时清除对应缓存项。
    this.subscriber = deps.redis.duplicate();
    this.subscriber.subscribe(SETTINGS_INVALIDATION_CHANNEL);
    this.subscriber.on('message', createSettingsInvalidationHandler(({ key }) => {
      this.cache.delete(key);
      this.logger.debug('settings cache invalidated', { key });
      if (LOG_RELOAD_KEYS.has(key)) {
        void this.applyLogSettings().catch((err) => {
          this.logger.error('reload log settings failed', {}, err as Error);
        });
      }
      // 如果是 storage/SSRF 相关配置，触发重建回调。
      if (STORAGE_REBUILD_KEYS.has(key) && this.onInvalidate) {
        try {
          this.onInvalidate([key]);
        } catch (err) {
          this.logger.error('onInvalidate callback failed', { key }, err as Error);
        }
      }
    }));
  }

  /** 启动时迁移 legacy env → DB（幂等）。 */
  async migrateFromEnv(): Promise<string[]> {
    try {
      return await this.store.migrateFromEnv();
    } catch (err) {
      this.logger.error('settings env migration failed', {}, err as Error);
      return [];
    }
  }

  /** 读取单个配置原始字符串（带缓存）。 */
  async getRaw(key: string): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const value = await this.store.getRaw(key);
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async getNumber(key: string): Promise<number | null> {
    const raw = await this.getRaw(key);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  async getBoolean(key: string): Promise<boolean | null> {
    const raw = await this.getRaw(key);
    if (raw === null || raw === '') return null;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }

  async getString(key: string): Promise<string | null> {
    return this.getRaw(key);
  }

  /** 读取 Secret（不缓存，每次走 DB）。 */
  async getSecret(key: string): Promise<string | null> {
    return this.store.getRaw(key);
  }

  /**
   * 获取 Pipeline 运行时配置快照（每次 job 执行时调用，获取最新值）。
   * 热路径配置（pollIntervalMs 等）通过缓存读取，避免每 job 查 DB。
   */
  async getPipelineConfig(env: {
    VIDEO_POLL_INTERVAL_MS: number;
    VIDEO_MAX_POLLS: number;
    VIDEO_MAX_WAIT_MS: number;
    CREDENTIAL_RETRY_ATTEMPTS: number;
    CREDENTIAL_LEASE_TTL_MS: number;
    PROVIDER_HTTP_TIMEOUT_MS: number;
    STORAGE_MAX_BYTES: number;
    STORAGE_DOWNLOAD_TIMEOUT_MS: number;
    STORAGE_ALLOWED_CONTENT_TYPES: string;
    SSRF_ALLOW_HTTP: boolean;
    SSRF_DEV_ALLOW_LIST: string;
    SSRF_RESOLVE_DNS: boolean;
    NODE_ENV: string;
  }): Promise<PipelineRuntimeConfig> {
    const pollIntervalMs = (await this.getNumber('video.pollIntervalMs')) ?? env.VIDEO_POLL_INTERVAL_MS;
    const maxPolls = (await this.getNumber('video.maxPolls')) ?? env.VIDEO_MAX_POLLS;
    const maxWaitMs = (await this.getNumber('video.maxWaitMs')) ?? env.VIDEO_MAX_WAIT_MS;
    const credentialRetryAttempts = (await this.getNumber('credential.retryAttempts')) ?? env.CREDENTIAL_RETRY_ATTEMPTS;
    const maxBytes = (await this.getNumber('storage.maxBytes')) ?? env.STORAGE_MAX_BYTES;
    const downloadTimeoutMs = (await this.getNumber('storage.downloadTimeoutMs')) ?? env.STORAGE_DOWNLOAD_TIMEOUT_MS;
    const allowedContentTypes = (await this.getString('storage.allowedContentTypes')) ?? env.STORAGE_ALLOWED_CONTENT_TYPES;
    const guard = await this.getSsrfGuard(env);

    return {
      pollIntervalMs,
      maxPolls,
      maxWaitMs,
      credentialRetryAttempts,
      credentialLeaseTtlMs: (await this.getNumber('credential.leaseTtlMs')) ?? env.CREDENTIAL_LEASE_TTL_MS,
      providerHttpTimeoutMs: (await this.getNumber('provider.httpTimeoutMs')) ?? env.PROVIDER_HTTP_TIMEOUT_MS,
      download: { guard, maxBytes, timeoutMs: downloadTimeoutMs },
      allowedContentTypePrefixes: allowedContentTypes.split(',').map((s) => s.trim()).filter(Boolean),
    };
  }

  /** 获取 SSRF guard 配置（storage/SSRF 重建时调用）。 */
  async getSsrfGuard(env: {
    SSRF_ALLOW_HTTP: boolean;
    SSRF_DEV_ALLOW_LIST: string;
    SSRF_RESOLVE_DNS: boolean;
    NODE_ENV: string;
  }): Promise<UrlGuardOptions> {
    const allowHttp = (await this.getBoolean('ssrf.allowHttp')) ?? env.SSRF_ALLOW_HTTP;
    const resolveDns = (await this.getBoolean('ssrf.resolveDns')) ?? env.SSRF_RESOLVE_DNS;
    const devAllowList = (await this.getString('ssrf.devAllowList')) ?? env.SSRF_DEV_ALLOW_LIST;
    return {
      allowHttp,
      resolveDns,
      devAllowlist: env.NODE_ENV !== 'production' ? devAllowList.split(',').map((s) => s.trim()).filter(Boolean) : [],
    };
  }

  /** 获取完整存储运行时配置（重建 ObjectStorage 时调用）。 */
  async getStorageConfig(env: StorageEnvironment & {
    STORAGE_MAX_BYTES: number;
    STORAGE_DOWNLOAD_TIMEOUT_MS: number;
    STORAGE_ALLOWED_CONTENT_TYPES: string;
    SSRF_ALLOW_HTTP: boolean;
    SSRF_DEV_ALLOW_LIST: string;
    SSRF_RESOLVE_DNS: boolean;
    NODE_ENV: string;
  }): Promise<StorageRuntimeConfig> {
    const storage = await resolveStorageConfig(this.store, env);
    const guard = await this.getSsrfGuard(env);
    const maxBytes = (await this.getNumber('storage.maxBytes')) ?? env.STORAGE_MAX_BYTES;
    const downloadTimeoutMs = (await this.getNumber('storage.downloadTimeoutMs')) ?? env.STORAGE_DOWNLOAD_TIMEOUT_MS;
    const allowedContentTypes = (await this.getString('storage.allowedContentTypes')) ?? env.STORAGE_ALLOWED_CONTENT_TYPES;

    return {
      ...storage,
      guard,
      maxBytes,
      downloadTimeoutMs,
      allowedContentTypePrefixes: allowedContentTypes.split(',').map((s) => s.trim()).filter(Boolean),
    };
  }

  /** 关闭 Redis 订阅连接。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.subscriber.quit();
  }

  /** 从 DB 读取并应用日志配置（启动时调用一次）。 */
  async applyLogSettings(): Promise<void> {
    const level = ((await this.getString('log.level')) ?? 'info') as 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';
    const format = ((await this.getString('log.format')) ?? 'text') as 'text' | 'json';
    this.logger.reconfigure({ level, format });
  }
}
