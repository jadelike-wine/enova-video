/**
 * P1-4: Settings v2 真实 PostgreSQL 集成测试。
 * 覆盖：CAS conflict / history / rollback / multi-instance invalidation。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { users, type Database } from '@enova/db';
import { SettingsStore, SettingsVersionConflictError, SettingNotRegisteredError } from '@enova/db';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_settings_test';

function maintenanceUrl(): string {
  const u = new URL(connectionString!);
  u.pathname = '/postgres';
  return u.toString();
}
function testDbUrl(): string {
  const u = new URL(connectionString!);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

async function resetDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: maintenanceUrl() });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}

async function applyMigrations(): Promise<{ db: Database; pool: Pool }> {
  const pool = new Pool({ connectionString: testDbUrl(), max: 20 });
  const drizzleDir = fileURLToPath(new URL('../../db/drizzle', import.meta.url));
  const files = readdirSync(drizzleDir).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
  for (const file of files) {
    const sql = readFileSync(join(drizzleDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
  }
  return { db: createDb(pool), pool };
}

import { createDbFromPool } from '@enova/db';
function createDb(pool: Pool): Database {
  return createDbFromPool(pool);
}

describe('SettingsStore v2 (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let store: SettingsStore;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    store = new SettingsStore(db, {});
  }, 60000);

  afterAll(async () => {
    if (!hasDb) return;
    await pool.end();
    const admin = new Pool({ connectionString: maintenanceUrl() });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } finally {
      await admin.end();
    }
  });

  it.skipIf(!hasDb)('CAS conflict：expectedVersion 不匹配时抛错', async () => {
    const { version } = await store.update('billing.welcomeCredits', '200', { reason: 'update' });
    expect(version).toBe(1);

    await expect(
      store.update('billing.welcomeCredits', '300', { expectedVersion: 99 }),
    ).rejects.toBeInstanceOf(SettingsVersionConflictError);

    // 正确的 expectedVersion 可成功
    const r2 = await store.update('billing.welcomeCredits', '300', { expectedVersion: 1 });
    expect(r2.version).toBe(2);
  });

  it.skipIf(!hasDb)('settings history：记录 before/after/reason/updatedBy', async () => {
    const [usr] = await db.insert(users).values({ email: `set-${crypto.randomUUID()}@t.com`, passwordHash: 'x' }).returning();
    await store.update('billing.welcomeCredits', '500', {
      expectedVersion: 2,
      updatedBy: usr.id,
      reason: 'seasonal promo',
      requestId: 'req-1',
    });

    const hist = await store.history('billing.welcomeCredits');
    // 最新一条 version=3
    expect(hist[0]!.version).toBe(3);
    expect(hist[0]!.after).toBe('500');
    expect(hist[0]!.before).toBe('300');
    expect(hist[0]!.reason).toBe('seasonal promo');
    expect(hist[0]!.updatedBy).toBe(usr.id);
    expect(hist[0]!.requestId).toBe('req-1');
  });

  it.skipIf(!hasDb)('rollback：恢复 before 值并 +1 版本', async () => {
    // 当前值为 500，version=3（来自上一用例）
    const hist = await store.history('billing.welcomeCredits');
    const firstChange = hist[hist.length - 1]!; // 最早一条（version=1，before=null, after=200）

    const { version } = await store.rollback('billing.welcomeCredits', firstChange.id, { reason: 'revert' });
    expect(version).toBe(4);
    const raw = await store.getRaw('billing.welcomeCredits');
    // 回滚到 version=1 的 before（null → 空串），即该历史 before 为空 → ''
    expect(raw).toBe('');
  });

  it.skipIf(!hasDb)('unregistered key 抛 SettingNotRegisteredError', async () => {
    await expect(store.update('nope.missing', '1')).rejects.toBeInstanceOf(SettingNotRegisteredError);
  });

  it.skipIf(!hasDb)('multi-instance invalidation：发布 key+version', async () => {
    const published: Array<{ key: string; version: number }> = [];
    const invalidator = {
      publish: async (key: string, version: number) => {
        published.push({ key, version });
      },
    };
    const s2 = new SettingsStore(db, {}, undefined, invalidator);
    await s2.update('log.level', 'debug', { reason: 'debug' });
    expect(published).toEqual(expect.arrayContaining([{ key: 'log.level', version: 1 }]));
  });
});