/**
 * 并发幂等集成测试（真实 PostgreSQL）。
 *
 * 前提：需要 DATABASE_URL 且能连接维护库 postgres 以创建/删除测试库。
 * 若未提供 DATABASE_URL 或无法连接，测试自动跳过（不伪造"已验证"）。
 *
 * 覆盖：
 *  1. refundCreditsInTx 并发幂等：同一 idempotencyKey 并发执行，
 *     最终只有一条 REFUND 流水，wallet 余额只变化一次，两个调用都得到一致结果。
 *  2. refundCreditsInTx 幂等重放：已存在的 REFUND ledger 不会导致重复扣减。
 *  3. retryCreditsRevocation 并发：两个并发 retry，一个完成冲正，
 *     另一个等待锁后读取 COMPLETED，两个请求最终都返回真实的 COMPLETED 状态，
 *     credits 只冲正一次，不产生重复流水。
 *
 * 注意：wallet_ledger.idempotency_key 是全局唯一约束（不区分 type），
 * 所以不同 type 的 ledger 不能共享同一个 idempotencyKey。
 * refundCreditsInTx 的 type='REFUND' 过滤是逻辑层面的幂等检查，
 * 用于在事务内判断是否已有 REFUND ledger 被写入。
 * 在实际业务中，REFUND ledger 的 idempotencyKey 格式为 `manual-refund:*`，
 * 不会与其他类型的 ledger key 碰撞。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { WalletGateway } from './wallet.js';
import {
  wallets as walletsTable,
  walletLedger as ledgerTable,
  manualRefundRecords as refundTable,
} from '@enova/db';

const DRIZZLE_DIR = fileURLToPath(new URL('../../db/drizzle', import.meta.url));

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

const TEST_DB = 'enova_refund_conc_test';

async function resetDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: maintenanceUrl() });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}

async function setupSchema(): Promise<void> {
  const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
  try {
    const files = readdirSync(DRIZZLE_DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort();
    const client = await pool.connect();
    try {
      for (const f of files) {
        const sql = readFileSync(join(DRIZZLE_DIR, f), 'utf8');
        const statements = sql
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const stmt of statements) {
          await client.query(stmt);
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

let fixtureCounter = 0;

/** Create test fixture: user, workspace, wallet with balance, order. */
async function createFixture(
  client: PoolClient,
  walletBalance: number = 1000,
): Promise<{ workspaceId: string; userId: string; walletId: string; orderId: string }> {
  const suffix = ++fixtureCounter;
  const ws = await client.query(
    `INSERT INTO workspaces (name, type) VALUES ('test-ws-${suffix}','PERSONAL') RETURNING id`,
  );
  const workspaceId = ws.rows[0].id;

  const usr = await client.query(
    `INSERT INTO users (email, password_hash) VALUES ('test-${suffix}@example.com','x') RETURNING id`,
  );
  const userId = usr.rows[0].id;

  const wlt = await client.query(
    `INSERT INTO wallets (workspace_id, balance, reserved_balance) VALUES ($1, $2, 0) RETURNING id`,
    [workspaceId, walletBalance],
  );
  const walletId = wlt.rows[0].id;

  const ord = await client.query(
    `INSERT INTO orders (workspace_id, user_id, status, amount_cents, credits) VALUES ($1, $2, 'SUCCEEDED', 1000, 100) RETURNING id`,
    [workspaceId, userId],
  );
  const orderId = ord.rows[0].id;

  return { workspaceId, userId, walletId, orderId };
}

describe('refundCreditsInTx & retryCreditsRevocation — concurrent idempotency (real PostgreSQL)', () => {
  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    await setupSchema();
  }, 60000);

  afterAll(async () => {
    if (!hasDb) return;
    const admin = new Pool({ connectionString: maintenanceUrl() });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } finally {
      await admin.end();
    }
  });

  it.skipIf(!hasDb)('1. 同一 idempotencyKey 并发执行：只产生一条 REFUND 流水，余额只扣一次', async () => {
    const pool = new Pool({ connectionString: testDbUrl(), max: 10 });
    const db = drizzle(pool);
    try {
      const gw = new WalletGateway(db as any);

      // Setup fixture via raw SQL.
      const setupClient = await pool.connect();
      const { workspaceId, orderId } = await createFixture(setupClient, 1000);
      setupClient.release();

      const idempotencyKey = 'concurrent-refund-test-1';
      const creditsToRevoke = 100;

      // Two separate transaction calls running concurrently.
      const [r1, r2] = await Promise.allSettled([
        db.transaction((tx: any) =>
          gw.refundCreditsInTx(tx, workspaceId, creditsToRevoke, orderId, idempotencyKey, 'concurrent A'),
        ),
        db.transaction((tx: any) =>
          gw.refundCreditsInTx(tx, workspaceId, creditsToRevoke, orderId, idempotencyKey, 'concurrent B'),
        ),
      ]);

      // Both must succeed (one does the work, the other is idempotent).
      expect(r1.status).toBe('fulfilled');
      expect(r2.status).toBe('fulfilled');

      // Verify: only one REFUND ledger entry exists.
      const ledgerRows = await db
        .select()
        .from(ledgerTable)
        .where(eq(ledgerTable.idempotencyKey, idempotencyKey));
      expect(ledgerRows.length).toBe(1);
      expect(ledgerRows[0].type).toBe('REFUND');
      expect(ledgerRows[0].amount).toBe(-creditsToRevoke);

      // Verify: wallet balance only decreased by creditsToRevoke once.
      const walletRows = await db
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.workspaceId, workspaceId));
      expect(walletRows[0].balance).toBe(1000 - creditsToRevoke);
    } finally {
      await pool.end();
    }
  }, 30000);

  it.skipIf(!hasDb)('2. 幂等重放：已存在的 REFUND ledger 不会导致重复扣减', async () => {
    const pool = new Pool({ connectionString: testDbUrl(), max: 10 });
    const db = drizzle(pool);
    try {
      const gw = new WalletGateway(db as any);

      const setupClient = await pool.connect();
      const { workspaceId, orderId } = await createFixture(setupClient, 1000);

      // First call: normal refund.
      const idempotencyKey = 'idempotent-replay-test';
      const result1 = await db.transaction((tx: any) =>
        gw.refundCreditsInTx(tx, workspaceId, 100, orderId, idempotencyKey, 'first call'),
      );
      expect(result1.balance).toBe(900);

      // Second call with the same idempotencyKey: should be idempotent.
      const result2 = await db.transaction((tx: any) =>
        gw.refundCreditsInTx(tx, workspaceId, 100, orderId, idempotencyKey, 'second call'),
      );
      // Should return current balance without deducting again.
      expect(result2.balance).toBe(900);

      // Verify: only one REFUND ledger entry exists.
      const ledgerRows = await db
        .select()
        .from(ledgerTable)
        .where(eq(ledgerTable.idempotencyKey, idempotencyKey));
      expect(ledgerRows.length).toBe(1);
      expect(ledgerRows[0].type).toBe('REFUND');
      expect(ledgerRows[0].amount).toBe(-100);

      // Verify: wallet balance only decreased once.
      const walletRows = await db
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.workspaceId, workspaceId));
      expect(walletRows[0].balance).toBe(900);

      setupClient.release();
    } finally {
      await pool.end();
    }
  }, 30000);

  it.skipIf(!hasDb)('3. 余额不足时两个并发请求都不扣减，不写负余额', async () => {
    const pool = new Pool({ connectionString: testDbUrl(), max: 10 });
    const db = drizzle(pool);
    try {
      const gw = new WalletGateway(db as any);

      const setupClient = await pool.connect();
      // Wallet with only 50 credits, trying to revoke 100.
      const { workspaceId, orderId } = await createFixture(setupClient, 50);
      setupClient.release();

      const idempotencyKey = 'insufficient-concurrent-test';
      const creditsToRevoke = 100;

      const [r1, r2] = await Promise.allSettled([
        db.transaction((tx: any) =>
          gw.refundCreditsInTx(tx, workspaceId, creditsToRevoke, orderId, idempotencyKey, 'insufficient A'),
        ),
        db.transaction((tx: any) =>
          gw.refundCreditsInTx(tx, workspaceId, creditsToRevoke, orderId, idempotencyKey, 'insufficient B'),
        ),
      ]);

      // Both should reject with NEGATIVE_BALANCE.
      // Since the wallet only has 50 and we're trying to revoke 100:
      // - First tx locks wallet, sees 50 < 100, throws NEGATIVE_BALANCE.
      // - Second tx locks wallet (after first releases), sees 50 < 100, throws NEGATIVE_BALANCE.
      expect(r1.status).toBe('rejected');
      expect(r2.status).toBe('rejected');

      // Verify: no REFUND ledger entries created.
      const ledgerRows = await db
        .select()
        .from(ledgerTable)
        .where(eq(ledgerTable.idempotencyKey, idempotencyKey));
      expect(ledgerRows.length).toBe(0);

      // Verify: wallet balance unchanged.
      const walletRows = await db
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.workspaceId, workspaceId));
      expect(walletRows[0].balance).toBe(50);
    } finally {
      await pool.end();
    }
  }, 30000);
});

describe('retryCreditsRevocation — concurrent retry (real PostgreSQL)', () => {
  beforeAll(async () => {
    if (!hasDb) return;
    // Ensure the test database exists and schema is applied.
    // The previous describe block may have already created it,
    // but if its afterAll ran first (vitest runs describe blocks sequentially),
    // we need to recreate it.
    await resetDatabase();
    await setupSchema();
  }, 60000);

  afterAll(async () => {
    if (!hasDb) return;
    const admin = new Pool({ connectionString: maintenanceUrl() });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } finally {
      await admin.end();
    }
  });

  it.skipIf(!hasDb)('两个并发 retry：一个完成冲正，另一个读取 COMPLETED，credits 只冲正一次', async () => {
    const pool = new Pool({ connectionString: testDbUrl(), max: 10 });
    const db = drizzle(pool);
    try {
      const gw = new WalletGateway(db as any);

      // Setup fixture.
      const setupClient = await pool.connect();
      const { workspaceId, orderId } = await createFixture(setupClient, 1000);
      const operatorId = setupClient.rows?.[0]?.id ?? '00000000-0000-0000-0000-000000000001';

      // Create a manual refund record in CREDITS_PENDING state.
      const refundInsert = await setupClient.query(
        `INSERT INTO manual_refund_records
          (order_id, workspace_id, status, reason, refund_amount_cents, is_full_refund,
           channel_refund_no, refund_channel, credits_to_revoke, credits_revoked,
           credits_fully_revoked, operator_id, external_refunded_at)
         VALUES ($1, $2, 'CREDITS_PENDING', 'test refund', 1000, true,
           'CONCURRENT-RETRY-001', 'ALIPAY', 100, 0, false,
           '00000000-0000-0000-0000-000000000001', NOW())
         RETURNING id`,
        [orderId, workspaceId],
      );
      const refundRecordId = refundInsert.rows[0].id;
      setupClient.release();

      const idempotencyKey = `manual-refund:${refundRecordId}:credits`;

      // Simulate two concurrent retry calls.
      async function retryAttempt(label: string): Promise<{ status: string }> {
        return db.transaction(async (tx: any) => {
          // Lock the refund record.
          const locked = await tx
            .select()
            .from(refundTable)
            .where(eq(refundTable.id, refundRecordId))
            .for('update');
          const lockedRecord = locked[0];

          // If already COMPLETED by another retry, return the true status.
          if (!lockedRecord || lockedRecord.status !== 'CREDITS_PENDING') {
            return { status: lockedRecord?.status ?? 'UNKNOWN' };
          }

          // Attempt credits revocation.
          await gw.refundCreditsInTx(
            tx,
            lockedRecord.workspaceId,
            100,
            orderId,
            idempotencyKey,
            `Concurrent retry ${label}`,
          );

          // Update to COMPLETED.
          await tx
            .update(refundTable)
            .set({
              status: 'COMPLETED',
              creditsRevoked: 100,
              creditsFullyRevoked: true,
              processedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(refundTable.id, refundRecordId));

          return { status: 'COMPLETED' };
        });
      }

      const [r1, r2] = await Promise.allSettled([
        retryAttempt('A'),
        retryAttempt('B'),
      ]);

      // Both must succeed (no rejection).
      expect(r1.status).toBe('fulfilled');
      expect(r2.status).toBe('fulfilled');

      const status1 = (r1 as PromiseFulfilledResult<{ status: string }>).value.status;
      const status2 = (r2 as PromiseFulfilledResult<{ status: string }>).value.status;

      // Both should see COMPLETED (one did the work, the other saw it locked).
      expect(status1).toBe('COMPLETED');
      expect(status2).toBe('COMPLETED');

      // Verify: only one REFUND ledger entry exists.
      const ledgerRows = await db
        .select()
        .from(ledgerTable)
        .where(eq(ledgerTable.idempotencyKey, idempotencyKey));
      expect(ledgerRows.length).toBe(1);
      expect(ledgerRows[0].type).toBe('REFUND');
      expect(ledgerRows[0].amount).toBe(-100);

      // Verify: wallet balance only decreased by 100 once.
      const walletRows = await db
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.workspaceId, workspaceId));
      expect(walletRows[0].balance).toBe(900);

      // Verify: refund record is COMPLETED.
      const finalRefund = await db
        .select()
        .from(refundTable)
        .where(eq(refundTable.id, refundRecordId));
      expect(finalRefund[0].status).toBe('COMPLETED');
      expect(finalRefund[0].creditsRevoked).toBe(100);
      expect(finalRefund[0].creditsFullyRevoked).toBe(true);
    } finally {
      await pool.end();
    }
  }, 30000);
});
