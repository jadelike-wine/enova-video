import { describe, expect, it } from 'vitest';
import { SettingsStore, type SettingsCrypto } from './settings-store.js';
import type { Database } from './index.js';

/** 极简 DB mock：记录 upsert 与 select 行为。 */
function createDb() {
  const records: Record<string, Record<string, string | boolean>> = {};
  const db = {
    select: () => ({
      from: (t: any) => {
        const key = tableName(t);
        const chain: any = {
          where: () => ({
            limit: async () =>
              Object.keys(records).includes(key) ? [{ value: records[key].value }] : [],
          }),
        };
        Object.defineProperty(chain, 'map', {
          get: () => (fn: any) => Object.values(records).map((r) => fn(r)),
        });
        return chain;
      },
    }),
    insert: (t: any) => {
      const key = tableName(t);
      return {
        values: (v: any) => ({
          onConflictDoUpdate: async (opts: any) => {
            records[key] = { ...v, ...opts.set };
          },
        }),
      };
    },
  };
  return { db: db as unknown as Database, records };
}

function tableName(t: any): string {
  if (typeof t === 'string') return t;
  const n = (t as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof n === 'string' ? n : String(t);
}

/** 可逆的测试加密（模拟 AES-GCM：base64 前后缀）。 */
const fakeCrypto: SettingsCrypto = {
  encrypt: (s: string) => `enc:${Buffer.from(s, 'utf8').toString('base64')}`,
  decrypt: (s: string) => Buffer.from(s.replace(/^enc:/, ''), 'base64').toString('utf8'),
};

const env: Record<string, unknown> = {
  WELCOME_CREDITS: 200,
  INITIAL_ADMIN_EMAIL: 'admin@example.com',
  PAYMENT_CREDITS_PER_CNY: 100,
  PAYMENT_MIN_RECHARGE_CENTS: 50,
};

describe('SettingsStore', () => {
  it('falls back to env/default when not persisted', async () => {
    const { db } = createDb();
    const store = new SettingsStore(db, env);
    expect(await store.getNumber('billing.welcomeCredits')).toBe(200); // env
    expect(await store.getString('auth.initialAdminEmail')).toBe('admin@example.com');
    expect(await store.getBoolean('billing.someMissing')).toBeNull();
    // 未在 env 也未设置的走注册表默认值
    expect(await store.getNumber('payment.creditsPerCny')).toBe(100);
  });

  it('returns persisted value over env', async () => {
    const { db, records } = createDb();
    const store = new SettingsStore(db, env);
    await store.set('billing.welcomeCredits', '500');
    expect(records['settings'].value).toBe('500');
    expect(await store.getNumber('billing.welcomeCredits')).toBe(500);
  });

  it('ignores unknown keys on write', async () => {
    const { db } = createDb();
    const store = new SettingsStore(db, env);
    await expect(store.set('not.registered', 'x')).resolves.toBeUndefined();
  });

  it('encrypts secret values at rest and decrypts on read', async () => {
    const { db, records } = createDb();
    const store = new SettingsStore(db, env, fakeCrypto);
    await store.set('payment.alipayPrivateKey', 'super-secret-key');
    // 落库为密文，不存明文
    expect(records['settings'].value).not.toContain('super-secret-key');
    expect(records['settings'].value).toContain('enc:');
    // 读取解密还原
    expect(await store.getString('payment.alipayPrivateKey')).toBe('super-secret-key');
    // list() 返回解密值
    const view = (await store.list()).find((s) => s.key === 'payment.alipayPrivateKey')!;
    expect(view.isSecret).toBe(true);
    expect(view.value).toBe('super-secret-key');
  });

  it('lists all registered settings with current effective values', async () => {
    const { db } = createDb();
    const store = new SettingsStore(db, env);
    const list = await store.list();
    expect(list.length).toBeGreaterThan(0);
    const welcome = list.find((s) => s.key === 'billing.welcomeCredits')!;
    expect(welcome.value).toBe('200');
    expect(welcome.persisted).toBe(false);
    const adminEmail = list.find((s) => s.key === 'auth.initialAdminEmail')!;
    expect(adminEmail.value).toBe('admin@example.com');
  });
});