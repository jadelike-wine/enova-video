import { and, desc, eq } from 'drizzle-orm';
import { settings, settingsHistory } from './schema.js';
import type { Database } from './index.js';
import {
  SETTINGS_BY_KEY,
  isRegisteredSetting,
  type SettingDef,
  type SettingGroup,
  type SettingValueType,
} from './settings-registry.js';

export interface SettingValueView {
  key: string;
  value: string;
  valueType: SettingValueType;
  group: SettingGroup;
  label: string;
  description?: string;
  isSecret: boolean;
  options?: string[];
  /** 是否被后台显式覆盖（DB 有记录）；false 表示当前取自 env/默认值。 */
  persisted: boolean;
}

/** 用于敏感配置的 AES-GCM 加解密接口（由调用方注入，如 CredentialCrypto）。 */
export interface SettingsCrypto {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

/** 变更上下文：谁、为什么、关联请求。 */
export interface UpdateActor {
  updatedBy?: string;
  requestId?: string;
  reason?: string;
}

/** 多实例失效通知：DB 更新后向所有 API/Worker 实例广播重载。 */
export interface SettingsInvalidator {
  publish(key: string, version: number): Promise<void>;
}

/** 配置冲突错误（CAS 失败）。 */
export class SettingsVersionConflictError extends Error {
  constructor(
    readonly key: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`SETTING_VERSION_CONFLICT: ${key} expected=${expected} actual=${actual}`);
    this.name = 'SettingsVersionConflictError';
  }
}

/** 未注册配置错误。 */
export class SettingNotRegisteredError extends Error {
  constructor(readonly key: string) {
    super(`SETTING_NOT_REGISTERED: ${key}`);
    this.name = 'SettingNotRegisteredError';
  }
}

/** 配置历史记录视图。 */
export interface SettingHistoryView {
  id: string;
  key: string;
  version: number;
  before?: string | null;
  after?: string | null;
  reason?: string | null;
  updatedBy?: string | null;
  requestId?: string | null;
  createdAt: Date;
}

/**
 * 动态配置存储（共享，纯 Node，非 NestJS）：
 * 读取时实时查 settings 表；未覆盖时回退到环境变量/注册表默认值。
 * 敏感项（isSecret）落库时加密、读取时解密，后台返回时由上层脱敏。
 * 供 API（NestJS 包装）与 Worker 直接使用。
 */
export class SettingsStore {
  constructor(
    private readonly db: Database,
    private readonly env: Record<string, unknown>,
    private readonly crypto?: SettingsCrypto,
    private readonly invalidator?: SettingsInvalidator,
  ) {}

  private envValue(def: SettingDef): string | null {
    if (!def.envKey) return null;
    const v = this.env[def.envKey];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
    return null;
  }

  /** 读取单个配置的原始字符串（已解析值用 getNumber/getBoolean/getString）。 */
  async getRaw(key: string): Promise<string | null> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) return null;

    const rows = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    const row = rows[0];
    if (row) {
      return def.isSecret && this.crypto ? this.crypto.decrypt(row.value) : row.value;
    }

    return this.envValue(def) ?? def.envDefault ?? null;
  }

  /** 读取 number 类型配置（未配置时为 null）。 */
  async getNumber(key: string): Promise<number | null> {
    const raw = await this.getRaw(key);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /** 读取 boolean 类型配置。 */
  async getBoolean(key: string): Promise<boolean | null> {
    const raw = await this.getRaw(key);
    if (raw === null || raw === '') return null;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }

  /** 读取 string 类型配置。 */
  async getString(key: string): Promise<string | null> {
    return this.getRaw(key);
  }

  /** 写入配置（upsert）。仅允许注册过的 key；敏感项先加密再落库。 */
  async set(key: string, value: string): Promise<void> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) return;

    const stored = def.isSecret && this.crypto ? this.crypto.encrypt(value) : value;
    await this.db
      .insert(settings)
      .values({
        key,
        value: stored,
        valueType: def.valueType,
        group: def.group,
        isSecret: def.isSecret ?? false,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: stored, updatedAt: new Date() },
      });
  }

  // ---- P1-4: Settings v2（CAS + history + rollback + multi-instance invalidation）----

  /** 将待存储的值编码（敏感项加密，与 settings.value 落库形式一致，保证 history 可安全回滚）。 */
  private encode(def: SettingDef, plaintext: string): string {
    return def.isSecret && this.crypto ? this.crypto.encrypt(plaintext) : plaintext;
  }

  /**
   * CAS 更新：`WHERE version = expectedVersion`。expectedVersion 不匹配或并发变更时抛
   * SettingsVersionConflictError。成功则版本 +1、写 settings_history、并向所有实例广播失效。
   */
  async update(
    key: string,
    plaintextValue: string,
    opts: { expectedVersion?: number } & UpdateActor = {},
  ): Promise<{ version: number }> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) throw new SettingNotRegisteredError(key);

    const stored = this.encode(def, plaintextValue);
    const rows = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    const current = rows[0];

    // 首次写入：version=1
    if (!current) {
      await this.db.insert(settings).values({ key, value: stored, valueType: def.valueType, group: def.group, isSecret: def.isSecret ?? false, version: 1 });
      await this.insertHistory(key, 1, null, stored, opts);
      await this.invalidator?.publish(key, 1);
      return { version: 1 };
    }

    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
      throw new SettingsVersionConflictError(key, opts.expectedVersion, current.version);
    }

    const nextVersion = current.version + 1;
    const [row] = await this.db
      .update(settings)
      .set({ value: stored, version: nextVersion, updatedAt: new Date() })
      .where(and(eq(settings.key, key), eq(settings.version, current.version)))
      .returning();
    if (!row) throw new SettingsVersionConflictError(key, current.version, nextVersion);

    await this.insertHistory(key, nextVersion, current.value, stored, opts);
    await this.invalidator?.publish(key, nextVersion);
    return { version: nextVersion };
  }

  /** 读取配置当前版本号（用于后台表单 CAS 提交）。 */
  async getVersion(key: string): Promise<number | null> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows[0]?.version ?? null;
  }

  /** 列出配置变更历史（倒序）。before/after 为存储态，敏感项由上层解密。 */
  async history(key: string, limit = 50): Promise<SettingHistoryView[]> {
    if (!isRegisteredSetting(key)) throw new SettingNotRegisteredError(key);
    const rows = await this.db
      .select()
      .from(settingsHistory)
      .where(eq(settingsHistory.key, key))
      .orderBy(desc(settingsHistory.version))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      version: r.version,
      before: r.before,
      after: r.after,
      reason: r.reason,
      updatedBy: r.updatedBy,
      requestId: r.requestId,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 回滚到指定历史版本：把该历史记录的 before 值恢复为当前值，版本 +1，写新历史并广播。
   * 返回回滚后的新版本。
   */
  async rollback(
    key: string,
    historyId: string,
    opts: UpdateActor = {},
  ): Promise<{ version: number }> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) throw new SettingNotRegisteredError(key);

    const histRows = await this.db
      .select()
      .from(settingsHistory)
      .where(and(eq(settingsHistory.key, key), eq(settingsHistory.id, historyId)))
      .limit(1);
    const hist = histRows[0];
    if (!hist) throw new Error(`SETTING_HISTORY_NOT_FOUND: ${key}/${historyId}`);

    const currentRows = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    const current = currentRows[0];
    if (!current) throw new Error(`SETTING_NOT_FOUND: ${key}`);

    const restoreValue = hist.before ?? '';
    const nextVersion = current.version + 1;
    const [row] = await this.db
      .update(settings)
      .set({ value: restoreValue, version: nextVersion, updatedAt: new Date() })
      .where(and(eq(settings.key, key), eq(settings.version, current.version)))
      .returning();
    if (!row) throw new SettingsVersionConflictError(key, current.version, nextVersion);

    await this.insertHistory(key, nextVersion, current.value, restoreValue, {
      ...opts,
      reason: opts.reason ?? `rollback to history ${historyId}`,
    });
    await this.invalidator?.publish(key, nextVersion);
    return { version: nextVersion };
  }

  private async insertHistory(
    key: string,
    version: number,
    before: string | null,
    after: string,
    actor: UpdateActor,
  ): Promise<void> {
    await this.db.insert(settingsHistory).values({
      key,
      version,
      before,
      after,
      reason: actor.reason,
      updatedBy: actor.updatedBy,
      requestId: actor.requestId,
    });
  }

  /** 列出全部注册配置及其当前生效值（敏感项解密后返回，是否脱敏由上层决定）。 */
  async list(): Promise<SettingValueView[]> {
    const rows = await this.db.select().from(settings);
    const persistedMap = new Map(rows.map((r) => [r.key, r]));

    const views: SettingValueView[] = [];
    for (const def of SETTINGS_BY_KEY.values()) {
      const row = persistedMap.get(def.key);
      let value: string;
      if (row) {
        value = def.isSecret && this.crypto ? this.crypto.decrypt(row.value) : row.value;
      } else {
        value = this.envValue(def) ?? def.envDefault ?? '';
      }
      views.push({
        key: def.key,
        value,
        valueType: def.valueType,
        group: def.group,
        label: def.label,
        description: def.description,
        isSecret: def.isSecret ?? false,
        options: def.options,
        persisted: Boolean(row),
      });
    }
    return views;
  }
}

/** 设置失效广播频道（多实例）。 */
export const SETTINGS_INVALIDATION_CHANNEL = 'enova:settings:invalidate';

/**
 * 基于 Redis Pub/Sub 的失效广播器（P1-4 多实例）。
 * 生产用 ioredis Publisher 实例；测试可注入内存替身。
 */
export class RedisSettingsInvalidator implements SettingsInvalidator {
  constructor(private readonly redis: { publish(channel: string, message: string): Promise<number> }) {}

  async publish(key: string, version: number): Promise<void> {
    await this.redis.publish(SETTINGS_INVALIDATION_CHANNEL, JSON.stringify({ key, version }));
  }
}

/**
 * 创建一个配置失效订阅者回调：其它 API/Worker 实例收到广播后重新加载该配置。
 * 返回一个可用于 Redis PubSub on('message') 的处理器。
 * 示例：
 *   const sub = new IORedis(REDIS_URL); sub.subscribe(CHANNEL);
 *   sub.on('message', createSettingsInvalidationHandler(() => reloadSetting));
 */
export function createSettingsInvalidationHandler(
  reload: (payload: { key: string; version: number }) => void,
): (channel: string, message: string) => void {
  return (channel, message) => {
    if (channel !== SETTINGS_INVALIDATION_CHANNEL) return;
    try {
      const payload = JSON.parse(message) as { key: string; version: number };
      reload(payload);
    } catch {
      // 忽略无法解析的广播，靠请求期/version poll 兜底最终一致
    }
  };
}