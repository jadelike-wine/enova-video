import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@enova/db';
import { SettingsStore } from '@enova/db';
import { CredentialCrypto } from '@enova/provider';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';

export type { SettingValueView } from '@enova/db';

/**
 * 动态配置服务（NestJS 薄包装）：
 * 具体读写/加密/兜底逻辑在共享的 SettingsStore（@enova/db）中，API、Worker 复用同一实现。
 * 管理员后台写入后立即生效，无需重启服务。
 */
@Injectable()
export class SettingsService {
  private readonly store: SettingsStore;

  constructor(
    @Inject(DATABASE) db: Database,
    @Inject(ENV) env: Env,
  ) {
    // 敏感配置用 CREDENTIAL_MASTER_KEY 做 AES-GCM。生产必有该 key；缺失时降级为不加密（仅测试）。
    const crypto = env.CREDENTIAL_MASTER_KEY
      ? CredentialCrypto.fromEnv(env.CREDENTIAL_MASTER_KEY)
      : undefined;
    this.store = new SettingsStore(db, env, crypto);
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

  set(key: string, value: string): Promise<void> {
    return this.store.set(key, value);
  }

  list() {
    return this.store.list();
  }
}