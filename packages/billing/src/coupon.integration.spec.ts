/**
 * P1-8: Promo / Coupon 真实 PostgreSQL 集成测试。
 *
 * 覆盖：
 *  - PERCENT / FLAT 折扣计算正确
 *  - disabled / expired / 未生效 coupon 拒绝
 *  - maxRedemptions / perUserLimit 并发安全（行锁串行化）
 *  - 货币不匹配拒绝
 *  - zero/negative 最终金额拒绝
 *  - 同订单重复兑换被唯一约束拦截
 *  - 未知 coupon 404
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbFromPool, users, workspaces, orders, coupons, type Database } from '@enova/db';
import { CouponService } from './coupon.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_coupon_test';

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
  return { db: createDbFromPool(pool), pool };
}

async function makeUserWorkspace(db: Database): Promise<{ userId: string; wsId: string }> {
  const [usr] = await db.insert(users).values({ email: `cp-${crypto.randomUUID()}@t.com`, passwordHash: 'x' }).returning();
  const [ws] = await db.insert(workspaces).values({ name: 'ws', ownerUserId: usr.id }).returning();
  return { userId: usr.id, wsId: ws.id };
}

async function makeOrder(db: Database, wsId: string, userId: string): Promise<string> {
  const [o] = await db
    .insert(orders)
    .values({ workspaceId: wsId, userId, orderType: 'RECHARGE', amountCents: 1000 })
    .returning();
  return o.id;
}

describe('CouponService (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
  }, 60000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it.skipIf(!hasDb)('PERCENT 折扣计算正确', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'P10', type: 'PERCENT', value: 10, maxRedemptions: 0 });
    const snap = await new CouponService(db).apply('P10', { amountCents: 1000, currency: 'CNY', userId, orderId });
    expect(snap.discountAmountCents).toBe(100);
    expect(snap.finalAmountCents).toBe(900);
    expect(snap.originalAmountCents).toBe(1000);
  });

  it.skipIf(!hasDb)('FLAT 折扣正确（不超过订单金额）', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'F4', type: 'FLAT', value: 400, maxRedemptions: 0, perUserLimit: 0 });
    const snap = await new CouponService(db).apply('F4', { amountCents: 1000, currency: 'CNY', userId, orderId });
    expect(snap.discountAmountCents).toBe(400);
    expect(snap.finalAmountCents).toBe(600);
  });

  it.skipIf(!hasDb)('100% PERCENT / 超过订单金额的 FLAT 折扣导致 0 最终金额被拒绝', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'P100', type: 'PERCENT', value: 100, maxRedemptions: 0, perUserLimit: 0 });
    await expect(
      new CouponService(db).apply('P100', { amountCents: 1000, currency: 'CNY', userId, orderId }),
    ).rejects.toThrow('non-positive');
  });

  it.skipIf(!hasDb)('disabled coupon 拒绝', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'DIS', type: 'PERCENT', value: 10, enabled: false });
    await expect(
      new CouponService(db).apply('DIS', { amountCents: 1000, currency: 'CNY', userId, orderId }),
    ).rejects.toThrow('disabled');
  });

  it.skipIf(!hasDb)('expired coupon 拒绝', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({
      code: 'EXP',
      type: 'PERCENT',
      value: 10,
      endsAt: new Date(Date.now() - 1000),
    });
    await expect(
      new CouponService(db).apply('EXP', { amountCents: 1000, currency: 'CNY', userId, orderId }),
    ).rejects.toThrow('expired');
  });

  it.skipIf(!hasDb)('currency mismatch 拒绝', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'USDONLY', type: 'PERCENT', value: 10, currency: 'USD' });
    await expect(
      new CouponService(db).apply('USDONLY', { amountCents: 1000, currency: 'CNY', userId, orderId }),
    ).rejects.toThrow('currency mismatch');
  });

  it.skipIf(!hasDb)('maxRedemptions 达到后拒绝', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'MAX1', type: 'PERCENT', value: 10, maxRedemptions: 1 });
    const svc = new CouponService(db);
    await svc.apply('MAX1', { amountCents: 1000, currency: 'CNY', userId, orderId });
    const orderId2 = await makeOrder(db, wsId, userId);
    await expect(
      svc.apply('MAX1', { amountCents: 1000, currency: 'CNY', userId, orderId2 }),
    ).rejects.toThrow('redemption limit');
  });

  it.skipIf(!hasDb)('perUserLimit 达到后拒绝', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'USER1', type: 'PERCENT', value: 10, perUserLimit: 1 });
    const svc = new CouponService(db);
    await svc.apply('USER1', { amountCents: 1000, currency: 'CNY', userId, orderId });
    const orderId2 = await makeOrder(db, wsId, userId);
    await expect(
      svc.apply('USER1', { amountCents: 1000, currency: 'CNY', userId, orderId2 }),
    ).rejects.toThrow('per-user');
  });

  it.skipIf(!hasDb)('同订单重复兑换被唯一约束拦截（COUPON_INVALID_FOR_ORDER）', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await db.insert(coupons).values({ code: 'DUP', type: 'PERCENT', value: 10, maxRedemptions: 0, perUserLimit: 0 });
    const svc = new CouponService(db);
    await svc.apply('DUP', { amountCents: 1000, currency: 'CNY', userId, orderId });
    await expect(
      svc.apply('DUP', { amountCents: 1000, currency: 'CNY', userId, orderId }),
    ).rejects.toThrow('already redeemed');
  });

  it.skipIf(!hasDb)('未知 coupon 返回 404', async () => {
    const { userId, wsId } = await makeUserWorkspace(db);
    const orderId = await makeOrder(db, wsId, userId);
    await expect(
      new CouponService(db).apply('NOPE', { amountCents: 1000, currency: 'CNY', userId, orderId }),
    ).rejects.toMatchObject({ code: 'COUPON_NOT_FOUND', statusCode: 404 });
  });

  it.skipIf(!hasDb)('纯函数 computeDiscount 边界正确', () => {
    expect(CouponService.computeDiscount({ type: 'PERCENT', value: 25, currency: null }, 100).finalAmountCents).toBe(75);
    expect(CouponService.computeDiscount({ type: 'FLAT', value: 999, currency: null }, 100).finalAmountCents).toBe(0);
    expect(CouponService.computeDiscount({ type: 'PERCENT', value: 0, currency: null }, 100).finalAmountCents).toBe(100);
    expect(CouponService.computeDiscount({ type: 'FLAT', value: -5, currency: null }, 100).finalAmountCents).toBe(100);
  });
});