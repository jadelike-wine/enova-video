import { Inject, Injectable, OnApplicationBootstrap, Optional } from '@nestjs/common';
import IORedis from 'ioredis';
import type { Database } from '@enova/db';
import {
  SettingsStore,
  RedisSettingsInvalidator,
  createSettingsInvalidationHandler,
  SETTINGS_INVALIDATION_CHANNEL,
  type SettingValueView,
  type UpdateActor,
} from '@enova/db';
import { CredentialCrypto } from '@enova/provider';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';
import type { EnovaLogger } from '../common/logger/enova-logger.js';

export type { SettingValueView, UpdateActor } from '@enova/db';

/** Redis 连接 token（settings pub/sub 专用，独立于 BullMQ 连接池）。 */
export const SETTINGS_REDIS = Symbol('SETTINGS_REDIS');

/** 需要热更新 logger 的配置 key 集合。 */
const LOG_RELOAD_KEYS = new Set(['log.level']);

/**
 * 动态配置服务（NestJS 薄包装）：
 * 具体读写/加密/兜底逻辑在共享的 SettingsStore（@enova/db）中，API、Worker 复用同一实现。
 *
 * 多实例一致性：
 * - 写入时通过 Redis pub/sub 广播失效，所有 API/Worker 实例收到后清除本地缓存。
 * - API 侧每次读取直接查 DB（无本地缓存），保证管理员修改后下一个请求即生效。
 * - Worker 侧维护内存缓存，收到 pub/sub 后重载（见 WorkerSettings）。
 *
 * 首次启动时自动从 legacy env 迁移配置到 DB（幂等，不覆盖已有 DB 值）。
 */
@Injectable()
export class SettingsService implements OnApplicationBootstrap {
  private readonly store: SettingsStore;
  private readonly subscriber?: IORedis;

  constructor(
    @Inject(DATABASE) db: Database,
    @Inject(ENV) env: Env,
    @Optional() @Inject(SETTINGS_REDIS) redis?: IORedis,
    @Optional() private readonly logger?: EnovaLogger,
  ) {
    const crypto = env.CREDENTIAL_MASTER_KEY
      ? CredentialCrypto.fromEnv(env.CREDENTIAL_MASTER_KEY)
      : undefined;
    // Redis pub/sub invalidator：写入后广播到所有实例。
    const invalidator = redis ? new RedisSettingsInvalidator(redis) : undefined;
    this.store = new SettingsStore(db, env, crypto, invalidator);

    // 订阅失效频道（API 多实例时，其它实例写入后通知本实例）。
    // API 侧无内存缓存，但日志级别变更需要热更新 logger。
    if (redis) {
      this.subscriber = redis.duplicate();
      this.subscriber.subscribe(SETTINGS_INVALIDATION_CHANNEL);
      this.subscriber.on('message', createSettingsInvalidationHandler(({ key }) => {
        if (LOG_RELOAD_KEYS.has(key) && this.logger) {
          // log.level 为 realtime：仅热更新日志级别，不重建日志器。
          // log.format 为 restartRequired，不受此 invalidation 影响。
          void this.store.getRaw('log.level').then((level) => {
            if (level) this.logger!.setLevel(level as 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace');
          }).catch(() => {
            // 静默失败：日志配置加载失败不影响业务。
          });
        }
      }));
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    // 首次启动：幂等迁移 legacy env → DB。绝不覆盖管理员后来修改的 DB 值。
    try {
      const migrated = await this.store.migrateFromEnv();
      if (migrated.length > 0) {
        // 不记录具体值（可能含 Secret），只记录 key 和数量。
        // eslint-disable-next-line no-console
        console.log(`[settings] migrated ${migrated.length} env vars to DB: ${migrated.join(', ')}`);
      }
    } catch {
      // 迁移失败不阻断启动——仍可从 env 兜底读取。
    }

    // 从 DB 读取并应用日志配置（热更新 logger level 和 prompts 开关）。
    await this.applyLogSettings();
  }

  /** 从 DB 读取并应用日志配置（启动时调用一次）。 */
  async applyLogSettings(): Promise<void> {
    if (!this.logger) return;
    const level = ((await this.getRaw('log.level')) ?? 'info') as 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';
    const format = ((await this.getRaw('log.format')) ?? 'text') as 'text' | 'json';
    // reconfigure：重建内部 Pino 实例，应用 log.format（restartRequired）。
    // 运行期间仅通过 setLevel() 热更新级别，不重建日志器。
    this.logger.reconfigure({ level, format });
  }

  getRaw(key: string): Promise<string | null> {
    return this.store.getRaw(key);
  }

  getNumber(key: string): Promise<number | null> {
    return this.store.getNumber(key);
  }

  getBoolean(key: string): Promise<boolean | null> {
    return this.store.getBoolean(key);
  }

  getString(key: string): Promise<string | null> {
    return this.store.getString(key);
  }

  /** 简单 upsert（无 CAS/history，保留兼容）。管理后台应优先使用 update()。 */
  set(key: string, value: string): Promise<void> {
    return this.store.set(key, value);
  }

  /** CAS 更新（写 history + 广播失效）。 */
  update(key: string, value: string, opts?: { expectedVersion?: number } & UpdateActor): Promise<{ version: number }> {
    return this.store.update(key, value, opts);
  }

  /** 批量原子更新（同组配置一致性）。Secret 留空=保持不变。 */
  updateGroup(updates: Array<{ key: string; value: string }>, opts?: UpdateActor): Promise<Array<{ key: string; version: number }>> {
    return this.store.updateGroup(updates, opts);
  }

  /** 批量读取多个配置（单次 SELECT ... WHERE key IN (...)，一致性快照）。 */
  getMany(keys: string[]): Promise<Map<string, string | null>> {
    return this.store.getMany(keys);
  }

  /** 清除 Secret。 */
  clearSecret(key: string, opts?: UpdateActor): Promise<{ version: number }> {
    return this.store.clearSecret(key, opts);
  }

  getVersion(key: string): Promise<number | null> {
    return this.store.getVersion(key);
  }

  history(key: string, limit?: number) {
    return this.store.history(key, limit);
  }

  list(): Promise<SettingValueView[]> {
    return this.store.list();
  }
}
