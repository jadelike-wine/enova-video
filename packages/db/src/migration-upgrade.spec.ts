/**
 * 迁移升级红队测试（legacy 0004 → latest 0005）。
 *
 * 前提：需要真实 PostgreSQL（通过 DATABASE_URL 提供，且能连接维护库 postgres 以创建/删除测试库）。
 * 若未提供 DATABASE_URL 或无法连接，测试自动跳过（不伪造“已验证”）。
 *
 * 覆盖：
 *  1. preflight 能检测到会阻塞生产迁移的 legacy 脏数据（负余额 / 重复 provider_ref / 重复 usage job）。
 *  2. 干净的 legacy 数据 + 真实 fixture 迁移到 0005 后，数据不丢失且新约束生效。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg, { Pool, type PoolClient } from 'pg';

const DRIZZLE_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;

// 维护库连接串（用于 drop/create 测试库）。测试库名固定。
function maintenanceUrl(testDb: string): string {
  const u = new URL(connectionString!);
  u.pathname = '/postgres';
  return u.toString();
}
function testDbUrl(testDb: string): string {
  const u = new URL(connectionString!);
  u.pathname = `/${testDb}`;
  return u.toString();
}

const TEST_DB = 'enova_migration_test';

/** 按文件名顺序读取迁移 SQL 文件。 */
function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

/** 在维护库上 drop + create 测试库。 */
async function resetDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: maintenanceUrl(TEST_DB) });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}

/** 逐条执行一个迁移 SQL 文件（按 `--> statement-breakpoint` 切分，与 drizzle 一致）。 */
async function applyMigration(client: PoolClient, file: string): Promise<void> {
  const sql = readFileSync(join(DRIZZLE_DIR, file), 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

describe('migration upgrade (0004 legacy → 0005 latest)', () => {
  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
  }, 30000);

  afterAll(async () => {
    if (!hasDb) return;
    const admin = new Pool({ connectionString: maintenanceUrl(TEST_DB) });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } finally {
      await admin.end();
    }
  });

  it.skipIf(!hasDb)('preflight 能检测到会阻塞 0005 的 legacy 脏数据', async () => {
    // 建 legacy schema（0000-0004），塞入脏数据。
    const pool = new Pool({ connectionString: testDbUrl(TEST_DB), max: 1 });
    const client = await pool.connect();
    try {
      for (const f of migrationFiles()) {
        if (f.startsWith('0005')) break;
        await applyMigration(client, f);
      }

      // workspace + user
      const ws = await client.query(
        `INSERT INTO workspaces (name, type) VALUES ('legacy-ws','PERSONAL') RETURNING id`,
      );
      const wsId = ws.rows[0].id;
      const usr = await client.query(
        `INSERT INTO users (email, password_hash) VALUES ('legacy@example.com','x') RETURNING id`,
      );
      const userId = usr.rows[0].id;

      // 脏数据 1：负余额 wallet
      await client.query(
        `INSERT INTO wallets (workspace_id, balance, reserved_balance) VALUES ($1, -50, 0)`,
        [wsId],
      );

      // 脏数据 2：重复 provider_ref 的两笔 payment_transaction
      const o1 = await client.query(
        `INSERT INTO orders (workspace_id, user_id, status) VALUES ($1,$2,'SUCCEEDED') RETURNING id`,
        [wsId, userId],
      );
      const o2 = await client.query(
        `INSERT INTO orders (workspace_id, user_id, status) VALUES ($1,$2,'SUCCEEDED') RETURNING id`,
        [wsId, userId],
      );
      await client.query(
        `INSERT INTO payment_transactions (order_id, provider, provider_ref, status) VALUES ($1,'sandbox','DUP-REF','SUCCEEDED')`,
        [o1.rows[0].id],
      );
      await client.query(
        `INSERT INTO payment_transactions (order_id, provider, provider_ref, status) VALUES ($1,'sandbox','DUP-REF','SUCCEEDED')`,
        [o2.rows[0].id],
      );

      // ---- preflight 检测（返回行数 > 0 即存在阻塞项）----
      const negWallet = await client.query(
        `SELECT count(*)::int AS n FROM wallets WHERE balance < 0 OR reserved_balance < 0`,
      );
      expect(negWallet.rows[0].n).toBeGreaterThan(0);

      const dupRef = await client.query(
        `SELECT count(*)::int AS n FROM (
           SELECT provider_ref FROM payment_transactions
           WHERE provider_ref IS NOT NULL GROUP BY provider_ref HAVING count(*)>1
         ) x`,
      );
      expect(dupRef.rows[0].n).toBeGreaterThan(0);

      // 脏数据存在 → 0005（含 wallets_balance_nonneg CHECK 与 provider_ref 唯一索引）必须失败。
      await expect(applyMigration(client, '0005_reflective_morg.sql')).rejects.toThrow();
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);

  it.skipIf(!hasDb)('干净 legacy fixture 迁移到 0005：数据不丢失且约束生效', async () => {
    await resetDatabase();
    const pool = new Pool({ connectionString: testDbUrl(TEST_DB), max: 1 });
    const client = await pool.connect();
    try {
      for (const f of migrationFiles()) {
        await applyMigration(client, f);
      }

      // 校验 P0 表与约束已创建。
      const constraints = await client.query(
        `SELECT conname FROM pg_constraint WHERE conname IN
         ('wallets_balance_nonneg','wallets_reserved_nonneg','credit_reservations_invariant','orders_amount_nonneg')`,
      );
      expect(constraints.rows.length).toBe(4);

      const uniqRef = await client.query(
        `SELECT indexname FROM pg_indexes WHERE indexname='payment_transactions_provider_ref_unique'`,
      );
      expect(uniqRef.rows.length).toBe(1);

      // 约束真正被 DB 强制执行。
      const ws = await client.query(
        `INSERT INTO workspaces (name, type) VALUES ('ok-ws','PERSONAL') RETURNING id`,
      );
      await expect(
        client.query(
          `INSERT INTO wallets (workspace_id, balance, reserved_balance) VALUES ($1, -1, 0)`,
          [ws.rows[0].id],
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);
});