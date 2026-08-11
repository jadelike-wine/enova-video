import { eq } from 'drizzle-orm';
import { settings } from './schema.js';
import type { Database } from './index.js';
import {
  SETTINGS_BY_KEY,
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