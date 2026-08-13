import { describe, expect, it, vi } from 'vitest';
import {
  SettingsStore,
  SettingsVersionConflictError,
  type SettingsCrypto,
  type SettingsInvalidator,
} from './settings-store.js';
import type { Database } from './index.js';

// ---------------------------------------------------------------------------
// Mock DB：支持 select/insert/update + onConflict + returning + where + transaction
// ---------------------------------------------------------------------------

interface MockRow {
  key: string;
  value: string;
  valueType: string;
  group: string;
  isSecret: boolean;
  version: number;
  updatedAt: Date;
}

function tableName(t: any): string {
  if (typeof t === 'string') return t;
  const n = (t as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof n === 'string' ? n : String(t);
}

function createDb() {
  const rows = new Map<string, MockRow>();
  const history: any[] = [];
  const historyIdCounter = { n: 0 };

  /** 递归从 drizzle SQL 对象（eq/and/...）中提取 setting key 值。 */
  function extractKey(filter: any): string | undefined {
    if (!filter) return undefined;
    if (typeof filter === 'object' && 'value' in filter) {
      const v = (filter as any).value;
      if (typeof v === 'string' && v.includes('.')) return v;
    }
    const chunks = (filter as any).queryChunks;
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) {
        const k = extractKey(chunk);
        if (k) return k;
      }
    }
    return undefined;
  }

  /** 创建查询 API mock（select/insert/update），通过闭包共享 rows/history。 */
  function createQueryApi(): any {
    const chainMap = new Map<string, any>();

    function getOrCreateChain(table: string) {
      let c = chainMap.get(table);
      if (!c) {
        if (table === 'settings') {
          c = {
            where: (filter: any) => {
              const keyVal = extractKey(filter);
              const base = Array.from(rows.values());
              const filtered = keyVal ? base.filter((r) => r.key === keyVal) : base;
              return {
                limit: async (n: number) => filtered.slice(0, n),
                orderBy: () => ({ limit: async (n: number) => filtered.slice(0, n) }),
              };
            },
            orderBy: () => c,
          };
          c.then = (resolve: any) => resolve(Array.from(rows.values()));
          c.map = (fn: any) => Array.from(rows.values()).map(fn);
        } else if (table === 'settings_history') {
          c = {
            where: (filter: any) => {
              const keyVal = extractKey(filter);
              const filtered = keyVal ? history.filter((h: any) => h.key === keyVal) : history;
              return {
                orderBy: () => ({
                  limit: async (n: number) =>
                    filtered.sort((a: any, b: any) => b.version - a.version).slice(0, n),
                }),
              };
            },
          };
        } else {
          c = { where: () => ({ limit: async () => [] }) };
        }
        chainMap.set(table, c);
      }
      return c;
    }

    return {
      select: () => ({
        from: (t: any) => {
          const table = tableName(t);
          return getOrCreateChain(table);
        },
      }),
      insert: (t: any) => {
        const table = tableName(t);
        return {
          values: (v: any) => ({
            onConflictDoUpdate: async (opts: any) => {
              const key = v.key;
              rows.set(key, {
                key,
                value: opts.set?.value ?? v.value,
                valueType: v.valueType ?? 'string',
                group: v.group ?? 'general',
                isSecret: v.isSecret ?? false,
                version: opts.set?.version ?? v.version ?? 1,
                updatedAt: opts.set?.updatedAt ?? new Date(),
              });
            },
            onConflictDoNothing: async () => {
              const key = v.key;
              if (!rows.has(key)) {
                rows.set(key, {
                  key,
                  value: v.value,
                  valueType: v.valueType ?? 'string',
                  group: v.group ?? 'general',
                  isSecret: v.isSecret ?? false,
                  version: v.version ?? 1,
                  updatedAt: new Date(),
                });
              }
            },
            then: (resolve: any) => {
              if (table === 'settings') {
                const key = v.key;
                rows.set(key, {
                  key,
                  value: v.value,
                  valueType: v.valueType ?? 'string',
                  group: v.group ?? 'general',
                  isSecret: v.isSecret ?? false,
                  version: v.version ?? 1,
                  updatedAt: new Date(),
                });
              } else if (table === 'settings_history') {
                historyIdCounter.n++;
                history.push({
                  id: `hist-${historyIdCounter.n}`,
                  key: v.key,
                  version: v.version,
                  before: v.before ?? null,
                  after: v.after,
                  reason: v.reason ?? null,
                  updatedBy: v.updatedBy ?? null,
                  requestId: v.requestId ?? null,
                  createdAt: new Date(),
                });
              }
              resolve(undefined);
            },
          }),
        };
      },
      update: (t: any) => ({
        set: (fields: any) => ({
          where: (filter: any) => {
            const keyVal = extractKey(filter);
            return {
              returning: async () => {
                if (keyVal && rows.has(keyVal)) {
                  const row = rows.get(keyVal)!;
                  rows.set(keyVal, { ...row, ...fields, updatedAt: new Date() });
                  return [rows.get(keyVal)!];
                }
                return [];
              },
            };
          },
        }),
      }),
    };
  }

  const db: any = {
    ...createQueryApi(),
    transaction: async (cb: (tx: any) => Promise<any>) => {
      // 事务层共享同一个 rows/history，提供一个带相同 API 的 tx 句柄
      const tx = createQueryApi();
      return cb(tx);
    },
  };
  return { db: db as unknown as Database, rows, history };
}

/** 可逆的测试加密（模拟 AES-GCM）。 */
const fakeCrypto: SettingsCrypto = {
  encrypt: (s: string) => `enc:${Buffer.from(s, 'utf8').toString('base64')}`,
  decrypt: (s: string) => {
    if (!s.startsWith('enc:')) return s;
    return Buffer.from(s.replace(/^enc:/, ''), 'base64').toString('utf8');
  },
};

/** 记录失效广播的 mock invalidator。 */
function createInvalidator(): SettingsInvalidator & { calls: Array<{ key: string; version: number }> } {
  const calls: Array<{ key: string; version: number }> = [];
  return {
    calls,
    publish: vi.fn(async (key: string, version: number) => {
      calls.push({ key, version });
    }),
  };
}

const baseEnv: Record<string, unknown> = {
  WELCOME_CREDITS: 200,
  PAYMENT_CREDITS_PER_CNY: 100,
  PAYMENT_MIN_RECHARGE_CENTS: 50,
  STORAGE_PROVIDER: 'none',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsStore', () => {
  describe('fallback / default', () => {
    it('falls back to env when not persisted', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv);
      expect(await store.getNumber('billing.welcomeCredits')).toBe(200);
      expect(await store.getBoolean('billing.someMissing')).toBeNull();
    });

    it('falls back to registry default when env not set', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      expect(await store.getNumber('billing.welcomeCredits')).toBe(100);
    });

    it('returns persisted DB value over env/default', async () => {
      const { db, rows } = createDb();
      const store = new SettingsStore(db, baseEnv);
      await store.set('billing.welcomeCredits', '500');
      expect(rows.get('billing.welcomeCredits')!.value).toBe('500');
      expect(await store.getNumber('billing.welcomeCredits')).toBe(500);
    });

    it('ignores unknown keys on write', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv);
      await expect(store.set('not.registered', 'x')).resolves.toBeUndefined();
    });

    it('returns null for unknown keys on read', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv);
      expect(await store.getRaw('not.registered')).toBeNull();
    });
  });

  describe('typed parsing', () => {
    it('parses number correctly', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, { WELCOME_CREDITS: '42' });
      expect(await store.getNumber('billing.welcomeCredits')).toBe(42);
    });

    it('parses boolean true variants', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, { SSRF_RESOLVE_DNS: 'true' });
      expect(await store.getBoolean('ssrf.resolveDns')).toBe(true);
    });

    it('parses boolean false variants', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, { SSRF_RESOLVE_DNS: '0' });
      expect(await store.getBoolean('ssrf.resolveDns')).toBe(false);
    });

    it('returns null for empty string number', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      await store.set('billing.welcomeCredits', '');
      expect(await store.getNumber('billing.welcomeCredits')).toBeNull();
    });
  });

  describe('secret encryption', () => {
    it('encrypts secret at rest and decrypts on read', async () => {
      const { db, rows } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.set('payment.alipayPrivateKey', 'super-secret-key');
      expect(rows.get('payment.alipayPrivateKey')!.value).not.toContain('super-secret-key');
      expect(rows.get('payment.alipayPrivateKey')!.value).toContain('enc:');
      expect(await store.getString('payment.alipayPrivateKey')).toBe('super-secret-key');
    });

    it('list() returns decrypted secrets with configured=true', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.set('payment.alipayPrivateKey', 'my-key');
      const view = (await store.list()).find((s) => s.key === 'payment.alipayPrivateKey')!;
      expect(view.isSecret).toBe(true);
      expect(view.value).toBe('my-key');
      expect(view.configured).toBe(true);
    });

    it('marks unconfigured secrets with configured=false', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      const view = (await store.list()).find((s) => s.key === 'payment.alipayPrivateKey')!;
      expect(view.isSecret).toBe(true);
      expect(view.configured).toBe(false);
    });

    it('does not encrypt non-secret values', async () => {
      const { db, rows } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.set('payment.mode', 'alipay');
      expect(rows.get('payment.mode')!.value).toBe('alipay');
    });
  });

  describe('CAS update + history', () => {
    it('creates first version on initial update', async () => {
      const { db, rows, history } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      const result = await store.update('billing.welcomeCredits', '300', {
        updatedBy: 'user-1',
        reason: 'test',
      });
      expect(result.version).toBe(1);
      expect(rows.get('billing.welcomeCredits')!.value).toBe('300');
      expect(history).toHaveLength(1);
      expect(history[0].version).toBe(1);
      expect(history[0].before).toBeNull();
      expect(history[0].after).toBe('300');
    });

    it('increments version on subsequent update', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.update('billing.welcomeCredits', '300');
      const result = await store.update('billing.welcomeCredits', '400');
      expect(result.version).toBe(2);
    });

    it('throws on CAS version mismatch', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.update('billing.welcomeCredits', '300');
      await expect(
        store.update('billing.welcomeCredits', '400', { expectedVersion: 99 }),
      ).rejects.toThrow(SettingsVersionConflictError);
    });

    it('encrypts secret on update and stores ciphertext in history', async () => {
      const { db, history } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.update('payment.alipayPrivateKey', 'secret-val');
      expect(history[0].after).not.toBe('secret-val');
      expect(history[0].after).toContain('enc:');
    });

    it('publishes invalidation on update', async () => {
      const { db } = createDb();
      const invalidator = createInvalidator();
      const store = new SettingsStore(db, baseEnv, fakeCrypto, invalidator);
      await store.update('billing.welcomeCredits', '300');
      expect(invalidator.calls).toHaveLength(1);
      expect(invalidator.calls[0].key).toBe('billing.welcomeCredits');
      expect(invalidator.calls[0].version).toBe(1);
    });
  });

  describe('legacy env migration', () => {
    it('migrates env vars to DB when DB is empty', async () => {
      const { db, rows } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      const migrated = await store.migrateFromEnv();
      expect(migrated).toContain('billing.welcomeCredits');
      expect(rows.get('billing.welcomeCredits')!.value).toBe('200');
    });

    it('does not overwrite existing DB values', async () => {
      const { db, rows } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.set('billing.welcomeCredits', '999');
      const migrated = await store.migrateFromEnv();
      expect(migrated).not.toContain('billing.welcomeCredits');
      expect(rows.get('billing.welcomeCredits')!.value).toBe('999');
    });

    it('encrypts secrets during migration', async () => {
      const { db, rows } = createDb();
      const envWithSecret = { ...baseEnv, ALIPAY_PRIVATE_KEY: 'legacy-secret' };
      const store = new SettingsStore(db, envWithSecret, fakeCrypto);
      const migrated = await store.migrateFromEnv();
      expect(migrated).toContain('payment.alipayPrivateKey');
      const stored = rows.get('payment.alipayPrivateKey')!.value;
      expect(stored).not.toBe('legacy-secret');
      expect(stored).toContain('enc:');
      expect(fakeCrypto.decrypt(stored)).toBe('legacy-secret');
    });

    it('is idempotent (second call migrates nothing)', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.migrateFromEnv();
      const second = await store.migrateFromEnv();
      expect(second).toHaveLength(0);
    });
  });

  describe('batch group update', () => {
    it('updates multiple settings in one call', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      const results = await store.updateGroup([
        { key: 'payment.mode', value: 'alipay' },
        { key: 'payment.creditsPerCny', value: '200' },
      ]);
      expect(results).toHaveLength(2);
      expect(await store.getString('payment.mode')).toBe('alipay');
      expect(await store.getNumber('payment.creditsPerCny')).toBe(200);
    });

    it('skips secret when value is empty (keep unchanged)', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.update('payment.alipayPrivateKey', 'original-secret');
      await store.updateGroup([
        { key: 'payment.mode', value: 'alipay' },
        { key: 'payment.alipayPrivateKey', value: '' },
      ]);
      expect(await store.getString('payment.alipayPrivateKey')).toBe('original-secret');
      expect(await store.getString('payment.mode')).toBe('alipay');
    });
  });

  describe('clear secret', () => {
    it('clears secret to empty string', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.update('payment.alipayPrivateKey', 'my-secret');
      expect(await store.getString('payment.alipayPrivateKey')).toBe('my-secret');
      await store.clearSecret('payment.alipayPrivateKey');
      expect(await store.getString('payment.alipayPrivateKey')).toBe('');
    });

    it('throws when clearing non-secret setting', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await expect(store.clearSecret('billing.welcomeCredits')).rejects.toThrow(/NOT_SECRET/);
    });
  });

  describe('list with metadata', () => {
    it('includes restartRequired for workerConcurrency', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      const list = await store.list();
      const wc = list.find((s) => s.key === 'queue.workerConcurrency')!;
      expect(wc.restartRequired).toBe(true);
      expect(wc.min).toBe(1);
      expect(wc.max).toBe(32);
    });

    it('includes permission for security settings', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      const list = await store.list();
      const ssrf = list.find((s) => s.key === 'ssrf.allowHttp')!;
      expect(ssrf.permission).toBe('settings.security_write');
      expect(ssrf.group).toBe('security');
    });

    it('includes groupKeys for payment.mode', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      const list = await store.list();
      const mode = list.find((s) => s.key === 'payment.mode')!;
      expect(mode.groupKeys).toBeDefined();
      expect(mode.groupKeys).toContain('payment.alipayAppId');
    });

    it('includes all storage S3 settings', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      const list = await store.list();
      const keys = list.map((s) => s.key);
      expect(keys).toContain('storage.provider');
      expect(keys).toContain('storage.s3Region');
      expect(keys).toContain('storage.s3AccessKey');
    });

    it('includes wechatPlatformCert setting', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, {});
      const list = await store.list();
      const keys = list.map((s) => s.key);
      expect(keys).toContain('payment.wechatPlatformCert');
    });
  });

  describe('history', () => {
    it('returns history entries ordered by version desc', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await store.update('billing.welcomeCredits', '300');
      await store.update('billing.welcomeCredits', '400');
      const history = await store.history('billing.welcomeCredits');
      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(2);
      expect(history[1].version).toBe(1);
    });

    it('throws for unregistered key', async () => {
      const { db } = createDb();
      const store = new SettingsStore(db, baseEnv, fakeCrypto);
      await expect(store.history('not.registered')).rejects.toThrow();
    });
  });
});