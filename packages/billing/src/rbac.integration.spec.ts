/**
 * P1-5: RBAC 真实 PostgreSQL 集成测试。
 * 覆盖：seed / Support 不可调 wallet / Finance 不可改 provider credential /
 * SuperAdmin 可分配角色 / 未授权抛 403(PermissionDeniedError) / 高危操作审计日志。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbFromPool, users, sensitiveActionLogs, roles, rolePermissions, type Database } from '@enova/db';
import { ADMIN_ROLES, PERMISSIONS } from '@enova/contracts';
import { RbacStore, PermissionDeniedError } from './rbac.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_rbac_test';

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

async function makeUser(db: Database): Promise<{ id: string }> {
  const [u] = await db.insert(users).values({ email: `rbac-${crypto.randomUUID()}@t.com`, passwordHash: 'x' }).returning();
  return { id: u.id };
}

describe('RbacStore (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let rbac: RbacStore;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    rbac = new RbacStore(db);
    await rbac.seed();
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

  it.skipIf(!hasDb)('Support 不能调整 wallet', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.SUPPORT);
    await expect(rbac.requirePermission(u.id, PERMISSIONS.WALLET_ADJUST)).rejects.toBeInstanceOf(PermissionDeniedError);
    // 但可读 wallet
    await expect(rbac.requirePermission(u.id, PERMISSIONS.WALLET_READ)).resolves.toBeUndefined();
  });

  it.skipIf(!hasDb)('Finance 不能修改 provider credential', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.FINANCE);
    await expect(rbac.requirePermission(u.id, PERMISSIONS.CREDENTIALS_ROTATE)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(rbac.requirePermission(u.id, PERMISSIONS.WALLET_ADJUST)).resolves.toBeUndefined();
  });

  it.skipIf(!hasDb)('SuperAdmin 可分配角色且拥有全部权限', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.SUPER_ADMIN);
    for (const p of Object.values(PERMISSIONS)) {
      await expect(rbac.requirePermission(u.id, p)).resolves.toBeUndefined();
    }
    // 可给他人分配角色
    const target = await makeUser(db);
    await expect(rbac.assignRole(target.id, ADMIN_ROLES.OPERATOR)).resolves.toBeUndefined();
    const roles = await rbac.rolesForUser(target.id);
    expect(roles).toContain(ADMIN_ROLES.OPERATOR);
  });

  it.skipIf(!hasDb)('未授权端点返回 403（PermissionDeniedError）', async () => {
    const u = await makeUser(db); // 无任何角色
    await expect(rbac.requirePermission(u.id, PERMISSIONS.ORDERS_READ)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it.skipIf(!hasDb)('高危操作写入敏感审计日志（含 stepUpMethod）', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.ADMIN);
    await rbac.guardSensitiveAction({
      userId: u.id,
      permission: PERMISSIONS.WALLET_ADJUST,
      target: 'user:abc',
      reason: 'manual adjustment',
      before: { credits: 100 },
      after: { credits: 90 },
      requestId: 'req-rbac-1',
      stepUpMethod: 'PASSWORD',
    });

    const logs = await db.select().from(sensitiveActionLogs);
    const entry = logs.find((l) => l.requestId === 'req-rbac-1');
    expect(entry).toBeDefined();
    expect(entry!.permission).toBe(PERMISSIONS.WALLET_ADJUST);
    expect(entry!.stepUpMethod).toBe('PASSWORD');
    expect(entry!.actorUserId).toBe(u.id);
  });

  it.skipIf(!hasDb)('step-up 验证失败时拒绝并抛 StepUpRequiredError', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.ADMIN);
    await expect(
      rbac.guardSensitiveAction({
        userId: u.id,
        permission: PERMISSIONS.WALLET_ADJUST,
        stepUp: { verify: async () => ({ ok: false, method: 'PASSWORD' }) },
      }),
    ).rejects.toThrow('STEP_UP_REQUIRED');
  });

  it.skipIf(!hasDb)('SUPPORT 可以 users.read', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.SUPPORT);
    await expect(rbac.requirePermission(u.id, PERMISSIONS.USERS_READ)).resolves.toBeUndefined();
  });

  it.skipIf(!hasDb)('FINANCE 可以 payments.read', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.FINANCE);
    await expect(rbac.requirePermission(u.id, PERMISSIONS.PAYMENTS_READ)).resolves.toBeUndefined();
  });

  it.skipIf(!hasDb)('DEVELOPER 可以 settings.write 但无 providers.write', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.DEVELOPER);
    // DEVELOPER 拥有 SETTINGS_WRITE（DEFAULT_ROLE_PERMISSIONS 实际配置）
    await expect(rbac.requirePermission(u.id, PERMISSIONS.SETTINGS_WRITE)).resolves.toBeUndefined();
    // DEVELOPER 没有 PROVIDERS_WRITE
    await expect(rbac.requirePermission(u.id, PERMISSIONS.PROVIDERS_WRITE)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it.skipIf(!hasDb)('DEVELOPER 不能调整 wallet', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.DEVELOPER);
    await expect(rbac.requirePermission(u.id, PERMISSIONS.WALLET_ADJUST)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it.skipIf(!hasDb)('SUPER_ADMIN 拥有 ROLE_ASSIGN 权限', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.SUPER_ADMIN);
    await expect(rbac.requirePermission(u.id, PERMISSIONS.ROLE_ASSIGN)).resolves.toBeUndefined();
  });

  it.skipIf(!hasDb)('role seed 幂等（重复执行不产生重复角色或映射）', async () => {
    const beforeRoles = await db.select().from(roles);
    const beforeRolePerms = await db.select().from(rolePermissions);
    // 重复 seed 两次，不应新增任何行
    await rbac.seed();
    await rbac.seed();
    const afterRoles = await db.select().from(roles);
    const afterRolePerms = await db.select().from(rolePermissions);
    expect(afterRoles.length).toBe(beforeRoles.length);
    expect(afterRolePerms.length).toBe(beforeRolePerms.length);
  });

  it.skipIf(!hasDb)('assignRole + removeRole 工作（含幂等分配）', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.OPERATOR);
    expect(await rbac.rolesForUser(u.id)).toContain(ADMIN_ROLES.OPERATOR);
    // 重复分配幂等，不产生重复关联
    await rbac.assignRole(u.id, ADMIN_ROLES.OPERATOR);
    const doubled = await rbac.rolesForUser(u.id);
    expect(doubled.filter((r) => r === ADMIN_ROLES.OPERATOR).length).toBe(1);
    // removeRole 后不再持有该角色
    await rbac.removeRole(u.id, ADMIN_ROLES.OPERATOR);
    expect(await rbac.rolesForUser(u.id)).not.toContain(ADMIN_ROLES.OPERATOR);
  });

  it.skipIf(!hasDb)('guardSensitiveAction 无 stepUp 写入 stepUpMethod=NONE', async () => {
    const u = await makeUser(db);
    await rbac.assignRole(u.id, ADMIN_ROLES.ADMIN);
    const result = await rbac.guardSensitiveAction({
      userId: u.id,
      permission: PERMISSIONS.WALLET_ADJUST,
      target: 'user:none-stepup',
      reason: 'no stepup required',
      requestId: 'req-rbac-none',
    });
    expect(result.stepUpMethod).toBe('NONE');
    const logs = await db.select().from(sensitiveActionLogs);
    const entry = logs.find((l) => l.requestId === 'req-rbac-none');
    expect(entry).toBeDefined();
    expect(entry!.stepUpMethod).toBe('NONE');
  });
});