/**
 * P1-3: Usage & Business Analytics 真实 PostgreSQL 集成测试。
 *
 * 前提：需要真实 PostgreSQL（DATABASE_URL），未提供则自动跳过。
 * 覆盖：Revenue/COGS/Margin、用户/任务规模、成功/失败率、成本质量、CSV 导出。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDbFromPool,
  users,
  workspaces,
  generationJobs,
  creditReservations,
  wallets,
  type Database,
} from '@enova/db';
import { BusinessAnalytics } from './analytics.js';
import { CostRevenueLedger, generateRevenueEventKey } from './cost-revenue.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_analytics_test';

function testDbUrl(): string {
  const u = new URL(connectionString!);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

async function resetDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL! });
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
  return { db: createDbFromPool(pool), pool };
}

async function seedUser(db: Database): Promise<{ userId: string; wsId: string }> {
  const [usr] = await db.insert(users).values({ email: `an-${crypto.randomUUID()}@t.com`, passwordHash: 'x' }).returning();
  const [ws] = await db.insert(workspaces).values({ name: 'ws', ownerUserId: usr.id }).returning();
  const [w] = await db.insert(wallets).values({ workspaceId: ws.id, balance: 0 }).returning();
  return { userId: usr.id, wsId: ws.id };
}

describe('BusinessAnalytics (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let analytics: BusinessAnalytics;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    analytics = new BusinessAnalytics(db);
  }, 60000);

  afterAll(async () => {
    if (!hasDb) return;
    await pool.end();
    const admin = new Pool({ connectionString: process.env.DATABASE_URL! });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } finally {
      await admin.end();
    }
  });

  it.skipIf(!hasDb)('看板聚合：jobs/credits/revenue/COGS/margin 正确', async () => {
    // 一个成功 job + 一个失败 job
    const { userId, wsId } = await seedUser(db);
    const [j1] = await db
      .insert(generationJobs)
      .values({ workspaceId: wsId, userId, type: 'VIDEO', status: 'SUCCEEDED', provider: 'agn', model: 'dream', estimatedCostMicrousd: 10000 })
      .returning();
    await db
      .insert(generationJobs)
      .values({ workspaceId: wsId, userId, type: 'IMAGE', status: 'FAILED', provider: 'agn', model: 'dream', estimatedCostMicrousd: 2000 })
      .returning();
    // 为 j1 预留并 capture 10 credits
    const [wallet] = await db.select().from(wallets).where(eq(wallets.workspaceId, wsId));
    await db.insert(creditReservations).values({
      walletId: wallet.id,
      workspaceId: wsId,
      generationJobId: j1.id,
      reservedCredits: 10,
      capturedCredits: 10,
      status: 'CAPTURED',
      idempotencyKey: `res:${j1.id}`,
    });
    // 收入 100 元（10000 分）
    const ledger = new CostRevenueLedger(db);
    await ledger.insertRevenueEvent({
      eventKey: generateRevenueEventKey(crypto.randomUUID()),
      workspaceId: wsId,
      userId,
      revenueType: 'RECHARGE',
      currency: 'CNY',
      grossAmountCents: 10000,
      recognizedAmountCents: 10000,
    });
    // 成本 70000 微美元（estimated）
    await ledger.insertCostEvent({
      eventKey: `an-test:${j1.id}:est`,
      workspaceId: wsId,
      userId,
      generationJobId: j1.id,
      costType: 'VIDEO_GENERATION',
      provider: 'agn',
      model: 'dream',
      quantity: 1,
      unit: 'seconds',
      unitCostMicrousd: 70000,
      totalCostMicrousd: 70000,
      status: 'ESTIMATED',
    });

    const d = await analytics.dashboard('30d');

    expect(d.product.jobs).toBe(2);
    expect(d.product.successRate).toBeGreaterThan(0);
    expect(d.usage.creditsCaptured).toBe(10);
    expect(d.business.recognizedRevenueCents).toBe(10000);
    expect(d.business.cogsMicrousd).toBe(70000);
    expect(d.business.grossMarginPercent).not.toBeNull();
    expect(d.business.ordersPaid).toBe(0);
    expect(d.costQuality.total).toBe(1);
    expect(d.costQuality.estimated).toBe(1);
    expect(d.costQuality.reconciled).toBe(0);
    expect(d.window.timezone).toBeTruthy();
    expect(d.calculatedAt).toBeTruthy();
  });

  it.skipIf(!hasDb)('CSV 导出包含指标行', async () => {
    const csv = await analytics.toCsv('24h');
    expect(csv).toContain('product.jobs');
    expect(csv).toContain('business.recognizedRevenueCents');
    expect(csv).toContain('costQuality.reconciled');
  });
});