/**
 * Wallet 真实 PostgreSQL 并发集成测试（P0 红队，Section 2 / 20）。
 *
 * 前提：需要真实 PostgreSQL（DATABASE_URL），且能连接维护库 postgres 以创建/删除测试库。
 * 未提供则自动跳过（不伪造“已验证”）。
 *
 * 覆盖：
 *  - Case 1: 多 job 并发 reserve + release/capture，最终各 job 结算正确、余额不漂移。
 *  - Case 2: 两事务并发 reserve 竞争同一余额，任一超卖被拒绝，余额不为负。
 *  - Case 3: capture(job) 与 release(job) 并发竞态，只产生一个合法终态。
 *  - Case 4: worker crash（事务中途抛错）回滚后数据一致。
 *  - Case 5: ledger 幂等冲突（重复 capture/release）不重复扣费/退费。
 *  - 每步后断言 wallet 聚合 == SUM(reservation residual)，balance>=0。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import {
  createDbFromPool,
  creditReservations,
  generationJobs,
  users,
  wallets,
  workspaces,
  type Database,
} from '@enova/db';
import { WalletGateway } from './wallet.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;

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

const TEST_DB = 'enova_wallet_concurrency_test';

async function resetDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: maintenanceUrl(TEST_DB) });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}

/** 返回带迁移 schema 的 db 实例与用于关闭的 pool。 */
async function applyMigrations(): Promise<{ db: Database; pool: Pool }> {
  const pool = new Pool({ connectionString: testDbUrl(TEST_DB), max: 20 });
  // packages/db/drizzle 目录：从本文件（packages/billing/src）向上两级
  const drizzleDir = fileURLToPath(new URL('../../db/drizzle', import.meta.url));
  const files = readdirSync(drizzleDir).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
  for (const file of files) {
    const sql = readFileSync(join(drizzleDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
  }
  return { db: createDbFromPool(pool), pool };
}

/** 断言 wallet 聚合不变量：reserved == SUM(residual)，balance/reserved >= 0。 */
async function assertWalletInvariant(db: Database, workspaceId: string): Promise<void> {
  const [w] = await db.select().from(wallets).where(eq(wallets.workspaceId, workspaceId));
  const res = await db
    .select({ reserved: creditReservations.reservedCredits, captured: creditReservations.capturedCredits, released: creditReservations.releasedCredits })
    .from(creditReservations)
    .where(eq(creditReservations.workspaceId, workspaceId));
  const expectedReserved = res.reduce((s, r) => s + Math.max(0, r.reserved - r.captured - r.released), 0);
  expect(w.balance).toBeGreaterThanOrEqual(0);
  expect(w.reservedBalance).toBeGreaterThanOrEqual(0);
  expect(w.reservedBalance).toBe(expectedReserved);
  return;
}

/** 新建一个 workspace + attached wallet（初始余额 balance）。返回 {wsId, userId}。 */
async function makeWallet(db: Database, balance: number): Promise<{ wsId: string; userId: string }> {
  const [usr] = await db
    .insert(users)
    .values({ email: `u-${crypto.randomUUID()}@t.com`, passwordHash: 'x' })
    .returning();
  const [ws] = await db.insert(workspaces).values({ name: 'ws', ownerUserId: usr.id }).returning();
  await db.insert(wallets).values({ workspaceId: ws.id, balance, reservedBalance: 0 });
  return { wsId: ws.id, userId: usr.id };
}

/** 为指定 workspace 创建一个真实 generation_job，返回其 id（credit_reservations 有 FK 指向它）。 */
async function makeJob(db: Database, wsId: string, userId: string): Promise<string> {
  const [j] = await db
    .insert(generationJobs)
    .values({ workspaceId: wsId, userId, type: 'VIDEO', status: 'QUEUED' })
    .returning();
  return j.id;
}

describe('wallet concurrency (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let gw: WalletGateway;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    gw = new WalletGateway(db);
  }, 60000);

  afterAll(async () => {
    if (!hasDb) return;
    await pool.end();
    const admin = new Pool({ connectionString: maintenanceUrl(TEST_DB) });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } finally {
      await admin.end();
    }
  });

  it.skipIf(!hasDb)('Case 1: 并发 reserve + release/capture，余额与预留聚合一致', async () => {
    const { wsId, userId } = await makeWallet(db, 1000);
    const jobA = await makeJob(db, wsId, userId);
    const jobB = await makeJob(db, wsId, userId);
    await gw.reserve(wsId, jobA, 300, `k1:${crypto.randomUUID()}`);
    await gw.reserve(wsId, jobB, 400, `k2:${crypto.randomUUID()}`);

    // 并发：A release，B capture 400
    const [a, b] = await Promise.all([
      gw.release(wsId, jobA, `relA:${crypto.randomUUID()}`),
      gw.capture(wsId, jobB, 400, `capB:${crypto.randomUUID()}`),
    ]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();

    const [w] = await db.select().from(wallets).where(eq(wallets.workspaceId, wsId));
    // balance = 1000 - 300(A入池) - 400(B入池) + 300(A释放) = 600
    expect(w.balance).toBe(600);
    // reserved = 0（A 已释放，B 已全额 capture 无剩余）
    expect(w.reservedBalance).toBe(0);
    await assertWalletInvariant(db, wsId);
  });

  it.skipIf(!hasDb)('Case 2: 两事务并发 reserve 竞争，不能超卖', async () => {
    const { wsId, userId } = await makeWallet(db, 500);
    const jobA = await makeJob(db, wsId, userId);
    const jobB = await makeJob(db, wsId, userId);

    const results = await Promise.allSettled([
      gw.reserve(wsId, jobA, 400, `ra:${crypto.randomUUID()}`),
      gw.reserve(wsId, jobB, 400, `rb:${crypto.randomUUID()}`),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    // 恰好一个成功，一个失败（余额不足）
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);

    const [w] = await db.select().from(wallets).where(eq(wallets.workspaceId, wsId));
    expect(w.balance).toBeGreaterThanOrEqual(0);
    await assertWalletInvariant(db, wsId);
  });

  it.skipIf(!hasDb)('Case 3: capture(job) 与 release(job) 并发，单一合法终态', async () => {
    const { wsId, userId } = await makeWallet(db, 200);
    const job = await makeJob(db, wsId, userId);
    await gw.reserve(wsId, job, 100, `k3:${crypto.randomUUID()}`);

    await Promise.allSettled([
      gw.capture(wsId, job, 100, `cap3:${crypto.randomUUID()}`),
      gw.release(wsId, job, `rel3:${crypto.randomUUID()}`),
    ]);
    // 无论先后，最终 reservation 状态必须是 CAPTURED 或 RELEASED 之一，且余额非负
    const [w] = await db.select().from(wallets).where(eq(wallets.workspaceId, wsId));
    expect(w.reservedBalance).toBe(0);
    // 两种终态：capture 100 → balance=100；release → balance=200
    expect([100, 200]).toContain(w.balance);
    await assertWalletInvariant(db, wsId);
  });

  it.skipIf(!hasDb)('Case 4: worker crash（事务中途抛错）回滚后数据一致', async () => {
    const { wsId, userId } = await makeWallet(db, 100);
    const job = await makeJob(db, wsId, userId);

    let threw = false;
    try {
      await db.transaction(async (tx) => {
        await gw.reserveInTx(tx, wsId, job, 50, `k4:${crypto.randomUUID()}`);
        // ledger 已写入，模拟 provider 请求后 crash
        throw new Error('simulated worker crash after reserve');
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // 事务回滚：wallet 无 reservation，余额保持 100，reserved 0
    const [w] = await db.select().from(wallets).where(eq(wallets.workspaceId, wsId));
    expect(w.balance).toBe(100);
    expect(w.reservedBalance).toBe(0);
    const res = await db.select().from(creditReservations).where(eq(creditReservations.generationJobId, job));
    expect(res.length).toBe(0);
  });

  it.skipIf(!hasDb)('Case 5: 重复 capture / release 幂等，不重复扣费/退费', async () => {
    const { wsId, userId } = await makeWallet(db, 100);
    const job = await makeJob(db, wsId, userId);
    const key = `cap5:${crypto.randomUUID()}`;
    await gw.reserve(wsId, job, 50, `res5:${crypto.randomUUID()}`);

    // 重复 capture（同一 idempotencyKey + 同一 job）：只结算一次
    await gw.capture(wsId, job, 50, key);
    await gw.capture(wsId, job, 50, key); // 幂等返回
    await gw.capture(wsId, job, 999, `cap5b:${crypto.randomUUID()}`); // 已 CAPTURED → 幂等返回，不超结

    const [w] = await db.select().from(wallets).where(eq(wallets.workspaceId, wsId));
    // reserve 50 → balance=50；capture 50 → remaining=0，无 release → balance 仍 50
    expect(w.balance).toBe(50);
    expect(w.reservedBalance).toBe(0);
    await assertWalletInvariant(db, wsId);
  });

  it.skipIf(!hasDb)('随机序列 property test：任意 reserve/capture/release/retry 序列不变量恒成立', async () => {
    const { wsId, userId } = await makeWallet(db, 500);

    // 预置 3 个 job 各 reserve 100
    const jobs = [await makeJob(db, wsId, userId), await makeJob(db, wsId, userId), await makeJob(db, wsId, userId)];
    for (const j of jobs) await gw.reserve(wsId, j, 100, `seed:${crypto.randomUUID()}`);

    // 随机操作：capture(0/50/100/200) 或 release，重复若干次（模拟 retry/竞态）
    const ops = new Array(20)
      .fill(0)
      .map(() => {
        const j = jobs[Math.floor(Math.random() * jobs.length)];
        const roll = Math.random();
        return roll < 0.5
          ? () => gw.capture(wsId, j, [0, 50, 100, 200][Math.floor(Math.random() * 4)], `cp:${crypto.randomUUID()}`)
          : () => gw.release(wsId, j, `rl:${crypto.randomUUID()}`);
      });

    await Promise.allSettled(ops.map((fn) => fn()));
    // 允许部分因“已释放后再 capture”而 reject（409），但余额与聚合必须始终一致、非负
    await assertWalletInvariant(db, wsId);
  });
});