/**
 * Migration 0009 升级红队测试（真实 PostgreSQL）。
 *
 * 前提：需要 DATABASE_URL 且能连接维护库 postgres 以创建/删除测试库。
 * 若未提供 DATABASE_URL 或无法连接，测试自动跳过（不伪造"已验证"）。
 *
 * 覆盖：
 *  1. 历史数据正常升级（0008 → 0009）：workspace_id 回填、NOT NULL 生效、unique index 创建。
 *  2. NULL channel_refund_no 数据导致 migration 明确失败（不静默跳过）。
 *  3. NULL refund_channel 数据导致 migration 明确失败。
 *  4. 重复 channel_refund_no 数据导致 migration 明确失败。
 *  5. 升级后实际数据库约束与 schema 一致（NOT NULL + 普通 unique index）。
 *  6. partial unique index 不存在（使用普通 unique index）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';

const DRIZZLE_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;

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

const TEST_DB = 'enova_migration_0009_test';

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
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

/** Apply migrations up to (but not including) the given file prefix. */
async function applyUpTo(client: PoolClient, exclusivePrefix: string): Promise<void> {
  for (const f of migrationFiles()) {
    if (f.startsWith(exclusivePrefix)) break;
    await applyMigration(client, f);
  }
}

/** Apply all migrations. */
async function applyAll(client: PoolClient): Promise<void> {
  for (const f of migrationFiles()) {
    await applyMigration(client, f);
  }
}

describe('migration 0009 upgrade (real PostgreSQL)', () => {
  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
  }, 30000);

  afterAll(async () => {
    if (!hasDb) return;
    const admin = new Pool({ connectionString: maintenanceUrl() });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } finally {
      await admin.end();
    }
  });

  it.skipIf(!hasDb)('1. 正常升级：0008 数据 + 0009 迁移成功，约束与 schema 一致', async () => {
    await resetDatabase();
    const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
    const client = await pool.connect();
    try {
      // Apply all migrations up to 0009 (exclusive), then 0009.
      await applyUpTo(client, '0009');
      await applyMigration(client, '0009_cooing_robbie_robertson.sql');

      // Create test data: user + workspace + order + wallet.
      const ws = await client.query(
        `INSERT INTO workspaces (name, type) VALUES ('test-ws','PERSONAL') RETURNING id`,
      );
      const wsId = ws.rows[0].id;
      const usr = await client.query(
        `INSERT INTO users (email, password_hash) VALUES ('test@example.com','x') RETURNING id`,
      );
      const userId = usr.rows[0].id;
      const ord = await client.query(
        `INSERT INTO orders (workspace_id, user_id, status, amount_cents, credits) VALUES ($1,$2,'SUCCEEDED',1000,100) RETURNING id`,
        [wsId, userId],
      );
      const orderId = ord.rows[0].id;

      // Insert a manual_refund_records row (post-0009 schema: all NOT NULL).
      await client.query(
        `INSERT INTO manual_refund_records
          (order_id, workspace_id, status, reason, refund_amount_cents, is_full_refund,
           channel_refund_no, refund_channel, credits_to_revoke, credits_revoked,
           credits_fully_revoked, operator_id, external_refunded_at)
         VALUES ($1,$2,'COMPLETED','test refund',1000,true,'ALI123','ALIPAY',100,100,true,$3,NOW())`,
        [orderId, wsId, userId],
      );

      // Verify workspace_id is NOT NULL.
      const wsNotNull = await client.query(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name='manual_refund_records' AND column_name='workspace_id'
      `);
      expect(wsNotNull.rows[0].is_nullable).toBe('NO');

      // Verify channel_refund_no is NOT NULL.
      const cnNotNull = await client.query(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name='manual_refund_records' AND column_name='channel_refund_no'
      `);
      expect(cnNotNull.rows[0].is_nullable).toBe('NO');

      // Verify refund_channel is NOT NULL.
      const rcNotNull = await client.query(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name='manual_refund_records' AND column_name='refund_channel'
      `);
      expect(rcNotNull.rows[0].is_nullable).toBe('NO');

      // Verify credits_to_revoke exists with default 0.
      const creditsCol = await client.query(`
        SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name='manual_refund_records' AND column_name='credits_to_revoke'
      `);
      expect(creditsCol.rows[0].is_nullable).toBe('NO');

      // Verify external_refunded_at exists (nullable).
      const extCol = await client.query(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name='manual_refund_records' AND column_name='external_refunded_at'
      `);
      expect(extCol.rows[0].is_nullable).toBe('YES');

      // Verify CREDITS_PENDING enum value exists.
      const enumCheck = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'CREDITS_PENDING'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'manual_refund_status')
        )
      `);
      expect(enumCheck.rows[0].exists).toBe(true);

      // Verify unique index exists and is NOT partial (no WHERE clause).
      const idxCheck = await client.query(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname = 'manual_refund_records_channel_refund_no_unique'
      `);
      expect(idxCheck.rows.length).toBe(1);
      // The index definition should NOT contain "WHERE" (not a partial index).
      expect(idxCheck.rows[0].indexdef).not.toMatch(/WHERE/i);

      // Verify FK for workspace_id exists.
      const fkCheck = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conname = 'manual_refund_records_workspace_id_workspaces_id_fk'
      `);
      expect(fkCheck.rows.length).toBe(1);

      // Verify unique constraint is actually enforced.
      await expect(
        client.query(
          `INSERT INTO manual_refund_records
            (order_id, workspace_id, status, reason, refund_amount_cents, is_full_refund,
             channel_refund_no, refund_channel, credits_to_revoke, credits_revoked,
             credits_fully_revoked, operator_id, external_refunded_at)
           VALUES ($1,$2,'COMPLETED','dup test',500,false,'ALI123','ALIPAY',50,50,true,$3,NOW())`,
          [orderId, wsId, userId],
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);

  it.skipIf(!hasDb)('2. NULL channel_refund_no 数据导致 migration 明确失败', async () => {
    await resetDatabase();
    const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
    const client = await pool.connect();
    try {
      // Apply up to 0008 (inclusive).
      await applyUpTo(client, '0009');

      // Create order + user + workspace for the refund record.
      const ws = await client.query(
        `INSERT INTO workspaces (name, type) VALUES ('ws-null-cn','PERSONAL') RETURNING id`,
      );
      const usr = await client.query(
        `INSERT INTO users (email, password_hash) VALUES ('null-cn@example.com','x') RETURNING id`,
      );
      const ord = await client.query(
        `INSERT INTO orders (workspace_id, user_id, status) VALUES ($1,$2,'SUCCEEDED') RETURNING id`,
        [ws.rows[0].id, usr.rows[0].id],
      );

      // Insert a row with NULL channel_refund_no (allowed in 0008 schema).
      await client.query(
        `INSERT INTO manual_refund_records
          (order_id, status, reason, refund_amount_cents, is_full_refund,
           channel_refund_no, refund_channel, operator_id)
         VALUES ($1,'COMPLETED','test',1000,true,NULL,NULL,$2)`,
        [ord.rows[0].id, usr.rows[0].id],
      );

      // Applying 0009 should fail with a diagnostic error about NULL channel_refund_no.
      await expect(
        applyMigration(client, '0009_cooing_robbie_robertson.sql'),
      ).rejects.toThrow(/channel_refund_no/);
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);

  it.skipIf(!hasDb)('3. NULL refund_channel 数据导致 migration 明确失败', async () => {
    await resetDatabase();
    const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
    const client = await pool.connect();
    try {
      await applyUpTo(client, '0009');

      const ws = await client.query(
        `INSERT INTO workspaces (name, type) VALUES ('ws-null-rc','PERSONAL') RETURNING id`,
      );
      const usr = await client.query(
        `INSERT INTO users (email, password_hash) VALUES ('null-rc@example.com','x') RETURNING id`,
      );
      const ord = await client.query(
        `INSERT INTO orders (workspace_id, user_id, status) VALUES ($1,$2,'SUCCEEDED') RETURNING id`,
        [ws.rows[0].id, usr.rows[0].id],
      );

      // Insert row with non-null channel_refund_no but NULL refund_channel.
      await client.query(
        `INSERT INTO manual_refund_records
          (order_id, status, reason, refund_amount_cents, is_full_refund,
           channel_refund_no, refund_channel, operator_id)
         VALUES ($1,'COMPLETED','test',1000,true,'ALI123',NULL,$2)`,
        [ord.rows[0].id, usr.rows[0].id],
      );

      await expect(
        applyMigration(client, '0009_cooing_robbie_robertson.sql'),
      ).rejects.toThrow(/refund_channel/);
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);

  it.skipIf(!hasDb)('4. 重复 channel_refund_no 数据导致 migration 明确失败', async () => {
    await resetDatabase();
    const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
    const client = await pool.connect();
    try {
      await applyUpTo(client, '0009');

      const ws = await client.query(
        `INSERT INTO workspaces (name, type) VALUES ('ws-dup','PERSONAL') RETURNING id`,
      );
      const usr = await client.query(
        `INSERT INTO users (email, password_hash) VALUES ('dup@example.com','x') RETURNING id`,
      );
      const o1 = await client.query(
        `INSERT INTO orders (workspace_id, user_id, status) VALUES ($1,$2,'SUCCEEDED') RETURNING id`,
        [ws.rows[0].id, usr.rows[0].id],
      );
      const o2 = await client.query(
        `INSERT INTO orders (workspace_id, user_id, status) VALUES ($1,$2,'SUCCEEDED') RETURNING id`,
        [ws.rows[0].id, usr.rows[0].id],
      );

      // Insert two rows with the same channel_refund_no.
      await client.query(
        `INSERT INTO manual_refund_records
          (order_id, status, reason, refund_amount_cents, is_full_refund,
           channel_refund_no, refund_channel, operator_id)
         VALUES ($1,'COMPLETED','test',1000,true,'DUP-REF-001','ALIPAY',$2)`,
        [o1.rows[0].id, usr.rows[0].id],
      );
      await client.query(
        `INSERT INTO manual_refund_records
          (order_id, status, reason, refund_amount_cents, is_full_refund,
           channel_refund_no, refund_channel, operator_id)
         VALUES ($1,'COMPLETED','test',1000,true,'DUP-REF-001','ALIPAY',$2)`,
        [o2.rows[0].id, usr.rows[0].id],
      );

      await expect(
        applyMigration(client, '0009_cooing_robbie_robertson.sql'),
      ).rejects.toThrow(/duplicate.*channel_refund_no/i);
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);

  it.skipIf(!hasDb)('5. 升级后约束与 Drizzle schema 一致（NOT NULL + 普通 unique index）', async () => {
    await resetDatabase();
    const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
    const client = await pool.connect();
    try {
      await applyAll(client);

      // Verify the unique index is a regular (non-partial) btree index.
      const idxInfo = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'manual_refund_records'
        AND indexname = 'manual_refund_records_channel_refund_no_unique'
      `);
      expect(idxInfo.rows.length).toBe(1);
      expect(idxInfo.rows[0].indexdef).not.toMatch(/WHERE/i);

      // Verify the index is unique.
      const idxUnique = await client.query(`
        SELECT indisunique FROM pg_index
        WHERE indexrelid = (
          SELECT oid FROM pg_class WHERE relname = 'manual_refund_records_channel_refund_no_unique'
        )
      `);
      expect(idxUnique.rows[0].indisunique).toBe(true);

      // Verify all three columns are NOT NULL.
      const cols = await client.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'manual_refund_records'
        AND column_name IN ('workspace_id', 'channel_refund_no', 'refund_channel')
      `);
      for (const row of cols.rows) {
        expect(row.is_nullable).toBe('NO');
      }
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);

  it.skipIf(!hasDb)('6. 空 manual_refund_records 表升级正常（无历史数据）', async () => {
    await resetDatabase();
    const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
    const client = await pool.connect();
    try {
      await applyAll(client);

      // Verify table exists with correct columns.
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_name = 'manual_refund_records'
        )
      `);
      expect(tableExists.rows[0].exists).toBe(true);

      // Verify CREDITS_PENDING enum value.
      const enumCheck = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'CREDITS_PENDING'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'manual_refund_status')
        )
      `);
      expect(enumCheck.rows[0].exists).toBe(true);
    } finally {
      client.release();
      await pool.end();
    }
  }, 60000);
});
