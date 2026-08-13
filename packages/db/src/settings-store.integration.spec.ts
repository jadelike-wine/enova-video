/**
 * SettingsStore 集成测试（需要真实 PostgreSQL）。
 * 启动: docker compose -f docker-compose.dev.yml up -d
 * 运行: pnpm --filter @enova/db test
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from './index.js';
import { settings, settingsHistory } from './schema.js';
import {
  SettingsStore,
  SettingsVersionConflictError,
  type SettingsCrypto,
  type SettingsInvalidator,
} from './settings-store.js';

const fakeCrypto: SettingsCrypto = {
  encrypt: (s: string) => `enc:${Buffer.from(s, 'utf8').toString('base64')}`,
  decrypt: (s: string) => {
    if (!s.startsWith('enc:')) return s;
    return Buffer.from(s.replace(/^enc:/, ''), 'base64').toString('utf8');
  },
};

const testEnv: Record<string, unknown> = {
  WELCOME_CREDITS: '200',
  STORAGE_PROVIDER: 'none',
  PAYMENT_MIN_RECHARGE_CENTS: '50',
};

// CI 无本地 PostgreSQL，无 DATABASE_URL 时整组跳过（与仓库其他集成测试一致）。
const hasDb = !!process.env.DATABASE_URL;

let db: ReturnType<typeof createDb>;
let store: SettingsStore;
let invalidator: SettingsInvalidator & { calls: Array<{ key: string; version: number }> };

beforeAll(() => {
  if (!hasDb) return;
  db = createDb('postgresql://enova:enova@localhost:5432/enova');
  invalidator = {
    calls: [],
    publish: async (key: string, version: number) => {
      invalidator.calls.push({ key, version });
    },
  };
  store = new SettingsStore(db, testEnv, fakeCrypto, invalidator);
});

afterAll(async () => {
  if (!hasDb) return;
  await db.delete(settingsHistory);
  await db.delete(settings);
});

describe.skipIf(!hasDb)('SettingsStore integration (real PG)', () => {
  describe('CAS update + history in same transaction', () => {
    it('creates first version with history', async () => {
      invalidator.calls = [];
      const result = await store.update('billing.welcomeCredits', '300', {
        reason: 'integration test',
      });

      expect(result.version).toBe(1);

      const hist = await store.history('billing.welcomeCredits');
      expect(hist).toHaveLength(1);
      expect(hist[0].version).toBe(1);
      expect(hist[0].before).toBeNull();
      expect(hist[0].after).toBe('300');
      expect(hist[0].reason).toBe('integration test');

      // invalidation 在 commit 后发布
      expect(invalidator.calls).toHaveLength(1);
      expect(invalidator.calls[0].key).toBe('billing.welcomeCredits');
      expect(invalidator.calls[0].version).toBe(1);
    });

    it('increments version on subsequent update', async () => {
      // 使用独立 key 避免与上一个测试共享状态
      const key = 'auth.turnstileEnabled';
      await store.update(key, 'true');
      const result = await store.update(key, 'false');
      expect(result.version).toBe(2);

      const hist = await store.history(key);
      expect(hist).toHaveLength(2);
      expect(hist[0].version).toBe(2);
      expect(hist[0].before).toBe('true');
      expect(hist[0].after).toBe('false');
    });

    it('throws on CAS version mismatch', async () => {
      const key = 'payment.creditsPerCny';
      await store.update(key, '100');
      await expect(
        store.update(key, '200', { expectedVersion: 99 }),
      ).rejects.toThrow(SettingsVersionConflictError);
    });

    it('secret is encrypted at rest', async () => {
      await store.update('payment.alipayPrivateKey', 'my-production-secret');
      const rows = await db.select().from(settings).where(eq(settings.key, 'payment.alipayPrivateKey')).limit(1);
      expect(rows[0].value).not.toBe('my-production-secret');
      expect(rows[0].value).toContain('enc:');

      const decrypted = await store.getString('payment.alipayPrivateKey');
      expect(decrypted).toBe('my-production-secret');
    });
  });

  describe('updateGroup atomic transaction', () => {
    it('updates multiple settings in one call', async () => {
      invalidator.calls = [];
      const results = await store.updateGroup([
        { key: 'payment.mode', value: 'alipay' },
        { key: 'payment.creditsPerCny', value: '200' },
      ]);
      expect(results).toHaveLength(2);
      expect(await store.getString('payment.mode')).toBe('alipay');
      expect(await store.getNumber('payment.creditsPerCny')).toBe(200);
      expect(invalidator.calls).toHaveLength(2);
    });

    it('rolls back all on partial failure', async () => {
      await store.update('payment.mode', 'sandbox');

      await expect(
        store.updateGroup([
          { key: 'payment.mode', value: 'wechat' },
          { key: 'not.registered', value: 'x' },
        ]),
      ).rejects.toThrow();

      // 验证 mode 没有被部分更新
      expect(await store.getString('payment.mode')).toBe('sandbox');
    });

    it('skips secret when value is empty', async () => {
      await store.update('payment.alipayPrivateKey', 'original-secret');
      await store.updateGroup([
        { key: 'payment.mode', value: 'alipay' },
        { key: 'payment.alipayPrivateKey', value: '' },
      ]);
      expect(await store.getString('payment.alipayPrivateKey')).toBe('original-secret');
      expect(await store.getString('payment.mode')).toBe('alipay');
    });
  });

  describe('getMany snapshot', () => {
    it('returns multiple settings in single snapshot', async () => {
      await store.update('payment.mode', 'sandbox');
      await store.update('payment.creditsPerCny', '100');

      const snapshot = await store.getMany(['payment.mode', 'payment.creditsPerCny', 'payment.minRechargeCents']);
      expect(snapshot.get('payment.mode')).toBe('sandbox');
      expect(snapshot.get('payment.creditsPerCny')).toBe('100');
      expect(snapshot.get('payment.minRechargeCents')).toBe('50'); // env fallback
    });

    it('returns decrypted secrets in snapshot', async () => {
      await store.update('payment.alipayPrivateKey', 'snapshot-secret');
      const snapshot = await store.getMany(['payment.alipayPrivateKey', 'payment.mode']);
      expect(snapshot.get('payment.alipayPrivateKey')).toBe('snapshot-secret');
    });
  });

  describe('legacy migration idempotency', () => {
    it('migrates from env when DB is empty', async () => {
      await db.delete(settings);
      store = new SettingsStore(db, testEnv, fakeCrypto, invalidator);

      const migrated = await store.migrateFromEnv();
      expect(migrated).toContain('billing.welcomeCredits');

      const val = await store.getNumber('billing.welcomeCredits');
      expect(val).toBe(200);
    });

    it('does not overwrite existing DB values', async () => {
      await store.update('billing.welcomeCredits', '999');
      const migrated = await store.migrateFromEnv();
      expect(migrated).not.toContain('billing.welcomeCredits');
      expect(await store.getNumber('billing.welcomeCredits')).toBe(999);
    });
  });
});