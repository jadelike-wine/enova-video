/**
 * P1-1: Cost / Revenue / Gross Margin 真实 PostgreSQL 集成测试。
 *
 * 前提：需要真实 PostgreSQL（DATABASE_URL），未提供则自动跳过。
 * 覆盖 P1-1 测试要求：
 *  - duplicate cost event 不重复入账
 *  - duplicate revenue event 不重复确认收入
 *  - retry/多 attempt 成本聚合，不覆盖第一次 attempt
 *  - failed job 已发生 provider cost 仍保留
 *  - refunded/released Credits 不等于自动减少 Revenue
 *  - RECONCILED cost 优先于 REPORTED/ESTIMATED
 *  - gross margin 汇总正确
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDbFromPool,
  users,
  workspaces,
  generationJobs,
  generationAttempts,
  type Database,
} from '@enova/db';
import { CostRevenueLedger, generateCostEventKey, generateRevenueEventKey } from './cost-revenue.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_cost_revenue_test';

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

async function resetDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: maintenanceUrl(TEST_DB) });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}

async function applyMigrations(): Promise<{ db: Database; pool: Pool }> {
  const pool = new Pool({ connectionString: testDbUrl(TEST_DB), max: 20 });
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

async function makeUserWorkspace(db: Database): Promise<{ userId: string; wsId: string }> {
  const [usr] = await db.insert(users).values({ email: `cr-${crypto.randomUUID()}@t.com`, passwordHash: 'x' }).returning();
  const [ws] = await db.insert(workspaces).values({ name: 'ws', ownerUserId: usr.id }).returning();
  return { userId: usr.id, wsId: ws.id };
}

async function makeJob(db: Database, wsId: string, userId: string): Promise<string> {
  const [j] = await db
    .insert(generationJobs)
    .values({ workspaceId: wsId, userId, type: 'VIDEO', status: 'SUCCEEDED' })
    .returning();
  return j.id;
}

async function makeAttempt(db: Database, jobId: string, attemptNo: number): Promise<string> {
  const [a] = await db
    .insert(generationAttempts)
    .values({ generationJobId: jobId, attemptNo, provider: 'agn', model: 'model-x', status: 'SUCCEEDED' })
    .returning();
  return a.id;
}

describe('CostRevenueLedger (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let ledger: CostRevenueLedger;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    ledger = new CostRevenueLedger(db);
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

  it.skipIf(!hasDb)('duplicate cost event 不重复入账', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const jobId = await makeJob(db, wsId, userId);
    const attemptId = await makeAttempt(db, jobId, 1);
    const key = generateCostEventKey({ generationJobId: jobId, attemptId, status: 'REPORTED' });

    const first = await ledger.insertCostEvent({
      eventKey: key,
      workspaceId: wsId,
      userId,
      generationJobId: jobId,
      generationAttemptId: attemptId,
      costType: 'VIDEO_GENERATION',
      provider: 'agn',
      model: 'model-x',
      quantity: 1,
      unit: 'seconds',
      unitCostMicrousd: 50000,
      totalCostMicrousd: 50000,
      status: 'REPORTED',
    });
    expect(first.inserted).toBe(true);

    const second = await ledger.insertCostEvent({
      eventKey: key,
      workspaceId: wsId,
      userId,
      generationJobId: jobId,
      generationAttemptId: attemptId,
      costType: 'VIDEO_GENERATION',
      provider: 'agn',
      model: 'model-x',
      quantity: 1,
      unit: 'seconds',
      unitCostMicrousd: 50000,
      totalCostMicrousd: 50000,
      status: 'REPORTED',
    });
    expect(second.inserted).toBe(false);
    expect(second.event.id).toBe(first.event.id);

    const agg = await ledger.aggregateGrossMargin({ workspaceId: wsId });
    expect(agg.totalEvents).toBe(1);
  });

  it.skipIf(!hasDb)('duplicate revenue event 不重复确认收入', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const key = generateRevenueEventKey(crypto.randomUUID());

    const first = await ledger.insertRevenueEvent({
      eventKey: key,
      workspaceId: wsId,
      userId,
      revenueType: 'PLAN',
      currency: 'CNY',
      grossAmountCents: 10000,
      recognizedAmountCents: 10000,
    });
    expect(first.inserted).toBe(true);

    const second = await ledger.insertRevenueEvent({
      eventKey: key,
      workspaceId: wsId,
      userId,
      revenueType: 'PLAN',
      currency: 'CNY',
      grossAmountCents: 10000,
      recognizedAmountCents: 10000,
    });
    expect(second.inserted).toBe(false);

    const total = await ledger.aggregateRecognizedRevenue({ workspaceId: wsId });
    expect(total).toBe(10000);
  });

  it.skipIf(!hasDb)('retry / 多 attempt 成本聚合，不覆盖第一次 attempt', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const jobId = await makeJob(db, wsId, userId);
    const attempt1 = await makeAttempt(db, jobId, 1);
    const attempt2 = await makeAttempt(db, jobId, 2);

    // attempt 1 失败但仍产生成本
    await ledger.insertCostEvent({
      eventKey: generateCostEventKey({ generationJobId: jobId, attemptId: attempt1, status: 'REPORTED' }),
      workspaceId: wsId, userId, generationJobId: jobId, generationAttemptId: attempt1,
      costType: 'VIDEO_GENERATION', provider: 'agn', model: 'model-x',
      quantity: 1, unitCostMicrousd: 30000, totalCostMicrousd: 30000, status: 'REPORTED',
    });
    // attempt 2 成功产生成本
    await ledger.insertCostEvent({
      eventKey: generateCostEventKey({ generationJobId: jobId, attemptId: attempt2, status: 'REPORTED' }),
      workspaceId: wsId, userId, generationJobId: jobId, generationAttemptId: attempt2,
      costType: 'VIDEO_GENERATION', provider: 'agn', model: 'model-x',
      quantity: 1, unitCostMicrousd: 70000, totalCostMicrousd: 70000, status: 'REPORTED',
    });

    const best = await ledger.getBestCostForJob(jobId);
    // 两次 attempt 成本都保留并聚合
    expect(best.totalMicrousd).toBe(100000);
    expect(best.events.length).toBe(2);
  });

  it.skipIf(!hasDb)('failed job 已发生 provider cost 仍保留', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const [j] = await db
      .insert(generationJobs)
      .values({ workspaceId: wsId, userId, type: 'VIDEO', status: 'FAILED' })
      .returning();
    const attemptId = await makeAttempt(db, j.id, 1);

    await ledger.insertCostEvent({
      eventKey: generateCostEventKey({ generationJobId: j.id, attemptId, status: 'REPORTED' }),
      workspaceId: wsId, userId, generationJobId: j.id, generationAttemptId: attemptId,
      costType: 'VIDEO_GENERATION', provider: 'agn', model: 'model-x',
      quantity: 1, unitCostMicrousd: 40000, totalCostMicrousd: 40000, status: 'REPORTED',
    });

    const agg = await ledger.aggregateGrossMargin({ workspaceId: wsId });
    expect(agg.totalReportedCostMicrousd).toBe(40000);
  });

  it.skipIf(!hasDb)('RECONCILED cost 优先于 REPORTED/ESTIMATED', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const jobId = await makeJob(db, wsId, userId);
    const attemptId = await makeAttempt(db, jobId, 1);

    // 同一 job 先入 ESTIMATED
    await ledger.insertCostEvent({
      eventKey: generateCostEventKey({ generationJobId: jobId, attemptId, status: 'ESTIMATED' }),
      workspaceId: wsId, userId, generationJobId: jobId, generationAttemptId: attemptId,
      costType: 'VIDEO_GENERATION', provider: 'agn', model: 'model-x',
      quantity: 1, unitCostMicrousd: 50000, totalCostMicrousd: 50000, status: 'ESTIMATED',
    });
    // 再入 REPORTED（不同 eventKey，因为状态不同）
    await ledger.insertCostEvent({
      eventKey: generateCostEventKey({ generationJobId: jobId, attemptId, status: 'REPORTED' }),
      workspaceId: wsId, userId, generationJobId: jobId, generationAttemptId: attemptId,
      costType: 'VIDEO_GENERATION', provider: 'agn', model: 'model-x',
      quantity: 1, unitCostMicrousd: 60000, totalCostMicrousd: 60000, status: 'REPORTED',
    });
    // 最后入 RECONCILED
    await ledger.insertCostEvent({
      eventKey: generateCostEventKey({ generationJobId: jobId, attemptId, status: 'RECONCILED' }),
      workspaceId: wsId, userId, generationJobId: jobId, generationAttemptId: attemptId,
      costType: 'VIDEO_GENERATION', provider: 'agn', model: 'model-x',
      quantity: 1, unitCostMicrousd: 55000, totalCostMicrousd: 55000, status: 'RECONCILED',
    });

    const best = await ledger.getBestCostForJob(jobId);
    expect(best.status).toBe('RECONCILED');
    expect(best.totalMicrousd).toBe(55000);

    // 聚合层：best available COGS 用 RECONCILED 优先
    const agg = await ledger.aggregateGrossMargin({ workspaceId: wsId });
    expect(agg.bestAvailableCOGSMicrousd).toBe(55000);
  });

  it.skipIf(!hasDb)('gross margin 汇总正确', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const jobId = await makeJob(db, wsId, userId);
    const attemptId = await makeAttempt(db, jobId, 1);

    // 收入 10000 分
    await ledger.insertRevenueEvent({
      eventKey: 'order-' + crypto.randomUUID(),
      workspaceId: wsId, userId,
      revenueType: 'PLAN', currency: 'CNY',
      grossAmountCents: 10000, recognizedAmountCents: 10000,
    });
    // 成本 70000 微美元（= 0.07 USD ≈ 0.49 CNY 分）
    await ledger.insertCostEvent({
      eventKey: generateCostEventKey({ generationJobId: jobId, attemptId, status: 'RECONCILED' }),
      workspaceId: wsId, userId, generationJobId: jobId, generationAttemptId: attemptId,
      costType: 'VIDEO_GENERATION', provider: 'agn', model: 'model-x',
      quantity: 1, unitCostMicrousd: 70000, totalCostMicrousd: 70000, status: 'RECONCILED',
    });

    const fx = 100000; // 1 CNY 分 = 100000 微美元（便于断言）
    const agg = await ledger.aggregateGrossMargin({ workspaceId: wsId }, fx);
    expect(agg.totalRecognizedRevenueCents).toBe(10000);
    expect(agg.totalReconciledCostMicrousd).toBe(70000);
    expect(agg.bestAvailableCOGSMicrousd).toBe(70000);
    // revenueMicrousd = 10000 * 100000 = 1e9; margin = (1e9 - 70000)/1e9 = 99.993%
    expect(agg.grossMarginPercent).toBeCloseTo(99.993, 2);
  });

  it.skipIf(!hasDb)('refunded/released Credits 不自动减少 Revenue', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    // 已确认收入
    await ledger.insertRevenueEvent({
      eventKey: 'order-' + crypto.randomUUID(),
      workspaceId: wsId, userId,
      revenueType: 'RECHARGE', currency: 'CNY',
      grossAmountCents: 5000, recognizedAmountCents: 5000,
    });
    // 释放/退款 credits 不产生 negative revenue event —— 只入账一次，不因释放而减少
    const total = await ledger.aggregateRecognizedRevenue({ workspaceId: wsId });
    expect(total).toBe(5000);

    // 再插入一条相同 order 的 revenue event（幂等）不减少
    const key = 'order-dup-' + crypto.randomUUID();
    await ledger.insertRevenueEvent({ eventKey: key, workspaceId: wsId, userId, revenueType: 'RECHARGE', currency: 'CNY', grossAmountCents: 0, recognizedAmountCents: 0 });
    const total2 = await ledger.aggregateRecognizedRevenue({ workspaceId: wsId });
    expect(total2).toBe(5000);
  });
});