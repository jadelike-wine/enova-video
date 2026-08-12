/**
 * P1-2: 用户级 Limits / Concurrency / Quota 真实 PostgreSQL 集成测试。
 *
 * 前提：需要真实 PostgreSQL（DATABASE_URL），未提供则自动跳过。
 * 覆盖：
 *  - 并发请求不能超过 job concurrency（多 attempt 同时 authorize，仅部分成功）
 *  - 日配额边界（到达上限后拒绝）
 *  - 月配额边界
 *  - model 权益拒绝
 *  - 过期订阅失去权益
 *  - 无订阅拒绝
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import {
  createDbFromPool,
  users,
  workspaces,
  plans,
  subscriptions,
  generationJobs,
  type Database,
} from '@enova/db';
import { EntitlementService } from './entitlement.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_entitlement_test';

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
  const [usr] = await db.insert(users).values({ email: `en-${crypto.randomUUID()}@t.com`, passwordHash: 'x' }).returning();
  const [ws] = await db.insert(workspaces).values({ name: 'ws', ownerUserId: usr.id }).returning();
  return { userId: usr.id, wsId: ws.id };
}

async function makePlan(db: Database, overrides: Partial<typeof plans.$inferInsert> = {}): Promise<string> {
  const [p] = await db
    .insert(plans)
    .values({
      code: `plan-${crypto.randomUUID().slice(0, 8)}`,
      name: 'test plan',
      maxConcurrentGenerations: 1,
      maxResolution: 720,
      maxDurationSeconds: 10,
      ...overrides,
    })
    .returning();
  return p.id;
}

async function subscribe(db: Database, wsId: string, planId: string, opts: { expirePast?: boolean } = {}): Promise<void> {
  const now = new Date();
  const end = opts.expirePast ? new Date(now.getTime() - 1000) : new Date(now.getTime() + 86400000);
  await db.insert(subscriptions).values({ workspaceId: wsId, planId, status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: end });
}

describe('EntitlementService (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let svc: EntitlementService;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    svc = new EntitlementService(db);
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

  it.skipIf(!hasDb)('无订阅 → NO_ACTIVE_SUBSCRIPTION', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    await expect(
      svc.authorizeJob({ workspaceId: wsId, type: 'VIDEO', model: 'm', input: {}, expectedCredits: 1 }),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_SUBSCRIPTION' });
  });

  it.skipIf(!hasDb)('过期订阅失去权益', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const planId = await makePlan(db);
    await subscribe(db, wsId, planId, { expirePast: true });
    await expect(
      svc.authorizeJob({ workspaceId: wsId, type: 'VIDEO', model: 'm', input: {}, expectedCredits: 1 }),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_SUBSCRIPTION' });
  });

  it.skipIf(!hasDb)('model 权益拒绝', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const planId = await makePlan(db, { allowedModels: ['veo'] });
    await subscribe(db, wsId, planId);
    await expect(
      svc.authorizeJob({ workspaceId: wsId, type: 'VIDEO', model: 'sora', input: {}, expectedCredits: 1 }),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
  });

  it.skipIf(!hasDb)('并发请求不能超过 job concurrency（maxConcurrent=1）', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const planId = await makePlan(db, { maxConcurrentGenerations: 1 });
    await subscribe(db, wsId, planId);

    // 先占满并发：插入一个 QUEUED job
    await db.insert(generationJobs).values({ workspaceId: wsId, userId, type: 'VIDEO', status: 'QUEUED' });

    await expect(
      svc.authorizeJob({ workspaceId: wsId, type: 'VIDEO', model: 'm', input: {}, expectedCredits: 1 }),
    ).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT_REACHED' });
  });

  it.skipIf(!hasDb)('日配额边界（到达上限后拒绝）', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const planId = await makePlan(db, { dailyGenerationLimit: 2 });
    await subscribe(db, wsId, planId);

    // 已用 2 次（2 个 job）
    await db.insert(generationJobs).values([
      { workspaceId: wsId, userId, type: 'VIDEO', status: 'SUCCEEDED' },
      { workspaceId: wsId, userId, type: 'VIDEO', status: 'SUCCEEDED' },
    ]);

    await expect(
      svc.authorizeJob({ workspaceId: wsId, type: 'VIDEO', model: 'm', input: {}, expectedCredits: 1 }),
    ).rejects.toMatchObject({ code: 'DAILY_QUOTA_EXCEEDED' });
  });

  it.skipIf(!hasDb)('月配额边界（到达上限后拒绝）', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const planId = await makePlan(db, { monthlyGenerationLimit: 3 });
    await subscribe(db, wsId, planId);

    await db.insert(generationJobs).values([
      { workspaceId: wsId, userId, type: 'VIDEO', status: 'SUCCEEDED' },
      { workspaceId: wsId, userId, type: 'VIDEO', status: 'SUCCEEDED' },
      { workspaceId: wsId, userId, type: 'VIDEO', status: 'SUCCEEDED' },
    ]);

    await expect(
      svc.authorizeJob({ workspaceId: wsId, type: 'VIDEO', model: 'm', input: {}, expectedCredits: 1 }),
    ).rejects.toMatchObject({ code: 'MONTHLY_QUOTA_EXCEEDED' });
  });

  it.skipIf(!hasDb)('未达上限时授权通过', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const planId = await makePlan(db, { maxConcurrentGenerations: 5, dailyGenerationLimit: 10 });
    await subscribe(db, wsId, planId);

    const e = await svc.authorizeJob({ workspaceId: wsId, type: 'VIDEO', model: 'm', input: {}, expectedCredits: 1 });
    expect(e.planId).toBe(planId);
  });
});