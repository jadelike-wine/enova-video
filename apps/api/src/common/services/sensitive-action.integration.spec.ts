/**
 * P1-5: SensitiveActionService & RBAC default-deny 真实 PostgreSQL 集成测试。
 * 覆盖：step-up 密码缺失/错误拒绝、权限不足拒绝、正确密码+权限成功并写审计日志、
 * legacy role=ADMIN 无 RBAC 分配默认拒绝、SUPER_ADMIN 拥有全部权限。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbFromPool, users, sensitiveActionLogs, type Database } from '@enova/db';
import { RbacStore, PermissionDeniedError } from '@enova/billing';
import { ADMIN_ROLES, ERROR_CODES, PERMISSIONS } from '@enova/contracts';
import { PasswordService } from '../../auth/password.service.js';
import { SensitiveActionService } from './sensitive-action.service.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_sensitive_action_test';

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
  const drizzleDir = fileURLToPath(new URL('../../../../../packages/db/drizzle', import.meta.url));
  const files = readdirSync(drizzleDir).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
  for (const file of files) {
    const sql = readFileSync(join(drizzleDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
  }
  return { db: createDbFromPool(pool), pool };
}

describe('SensitiveActionService (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let rbac: RbacStore;
  let sensitiveAction: SensitiveActionService;
  let passwordService: PasswordService;
  let testUserId: string;
  const testPassword = 'test-password-123';

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    rbac = new RbacStore(db);
    await rbac.seed();
    passwordService = new PasswordService();
    sensitiveAction = new SensitiveActionService(rbac, db, passwordService);

    // Create test user with password hash
    const hash = await passwordService.hash(testPassword);
    const [user] = await db
      .insert(users)
      .values({
        email: 'sensitive-test@test.com',
        passwordHash: hash,
        role: 'USER',
        status: 'ACTIVE',
      })
      .returning();
    testUserId = user!.id;

    // Assign ADMIN role so user has wallet.adjust permission
    await rbac.assignRole(testUserId, ADMIN_ROLES.ADMIN);
  }, 60000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it.skipIf(!hasDb)('rejects when no step-up password provided', async () => {
    await expect(
      sensitiveAction.execute({
        actorUserId: testUserId,
        permission: PERMISSIONS.WALLET_ADJUST,
        target: 'user:test',
        stepUpPassword: undefined,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN, statusCode: 403 });
  });

  it.skipIf(!hasDb)('rejects when step-up password is wrong', async () => {
    await expect(
      sensitiveAction.execute({
        actorUserId: testUserId,
        permission: PERMISSIONS.WALLET_ADJUST,
        target: 'user:test',
        stepUpPassword: 'wrong-password',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN, statusCode: 403 });
  });

  it.skipIf(!hasDb)('rejects when user lacks required permission', async () => {
    // Create a SUPPORT user (no wallet.adjust)
    const hash = await passwordService.hash(testPassword);
    const [supportUser] = await db
      .insert(users)
      .values({
        email: 'support-test@test.com',
        passwordHash: hash,
        role: 'USER',
        status: 'ACTIVE',
      })
      .returning();
    await rbac.assignRole(supportUser!.id, ADMIN_ROLES.SUPPORT);

    await expect(
      sensitiveAction.execute({
        actorUserId: supportUser!.id,
        permission: PERMISSIONS.WALLET_ADJUST,
        stepUpPassword: testPassword,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it.skipIf(!hasDb)('succeeds with correct password + permission, writes audit log', async () => {
    const result = await sensitiveAction.execute({
      actorUserId: testUserId,
      permission: PERMISSIONS.WALLET_ADJUST,
      target: 'user:test-target',
      reason: 'Credit adjustment test',
      before: { balance: 100 },
      after: { balance: 80 },
      requestId: 'test-req-123',
      stepUpPassword: testPassword,
    });
    expect(result.stepUpMethod).toBe('PASSWORD');
    expect(result.audited).toBe(true);

    // Verify audit log was written
    const logs = await db.select().from(sensitiveActionLogs).where(eq(sensitiveActionLogs.actorUserId, testUserId));
    expect(logs.length).toBeGreaterThan(0);
    const log = logs[logs.length - 1]!;
    expect(log.permission).toBe('wallet.adjust');
    expect(log.target).toBe('user:test-target');
    expect(log.stepUpMethod).toBe('PASSWORD');
    expect(log.reason).toBe('Credit adjustment test');
  });

  it.skipIf(!hasDb)('legacy role=ADMIN without RBAC assignment is denied', async () => {
    // Create a user with role='ADMIN' but NO RBAC role assignment
    const hash = await passwordService.hash(testPassword);
    const [legacyAdmin] = await db
      .insert(users)
      .values({
        email: 'legacy-admin@test.com',
        passwordHash: hash,
        role: 'ADMIN', // Legacy DB field
        status: 'ACTIVE',
      })
      .returning();
    // Do NOT assign any RBAC role

    // Should be denied because PermissionGuard no longer has legacy fallback
    const hasPerm = await rbac.hasPermission(legacyAdmin!.id, PERMISSIONS.WALLET_ADJUST);
    expect(hasPerm).toBe(false);

    // SensitiveAction should also reject
    await expect(
      sensitiveAction.execute({
        actorUserId: legacyAdmin!.id,
        permission: PERMISSIONS.WALLET_ADJUST,
        stepUpPassword: testPassword,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it.skipIf(!hasDb)('SUPER_ADMIN has all permissions', async () => {
    const hash = await passwordService.hash(testPassword);
    const [superAdmin] = await db
      .insert(users)
      .values({
        email: 'super-admin@test.com',
        passwordHash: hash,
        role: 'ADMIN',
        status: 'ACTIVE',
      })
      .returning();
    await rbac.assignRole(superAdmin!.id, ADMIN_ROLES.SUPER_ADMIN);

    // Should have all permissions
    for (const perm of Object.values(PERMISSIONS)) {
      expect(await rbac.hasPermission(superAdmin!.id, perm)).toBe(true);
    }
  });
});
