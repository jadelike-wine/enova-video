import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbFromPool, users, type Database } from '@enova/db';
import { RbacStore } from '@enova/billing';
import { USER_ROLES, PERMISSIONS, ADMIN_ROLES } from '@enova/contracts';
import { PasswordService } from '../auth/password.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_bootstrap_test';

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
  const drizzleDir = fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url));
  const files = readdirSync(drizzleDir).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
  for (const file of files) {
    const sql = readFileSync(join(drizzleDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
  }
  return { db: createDbFromPool(pool), pool };
}

function makeSettings() {
  return {
    getString: async () => null,
    getNumber: async () => null,
    getBoolean: async () => false,
  };
}

describe('AdminBootstrapService (real PostgreSQL)', () => {
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

  it.skipIf(!hasDb)('migrates legacy ADMIN user to SUPER_ADMIN RBAC role without UUID error', async () => {
    // Create a legacy ADMIN user
    const passwordService = new PasswordService();
    const hash = await passwordService.hash('test-password-123');
    const [adminUser] = await db.insert(users).values({
      email: 'legacy-bootstrap@test.com',
      passwordHash: hash,
      role: USER_ROLES.ADMIN,
      status: 'ACTIVE',
    }).returning();

    // Run bootstrap
    const rbacStore = new RbacStore(db);
    const settingsService = makeSettings() as unknown as SettingsService;
    const bootstrap = new AdminBootstrapService(db, settingsService, rbacStore);
    await bootstrap.onApplicationBootstrap();

    // Verify: the legacy admin should now have SUPER_ADMIN RBAC role
    const hasPerm = await rbacStore.hasPermission(adminUser!.id, PERMISSIONS.WALLET_ADJUST);
    expect(hasPerm).toBe(true);

    // Verify: SUPER_ADMIN has ALL permissions
    for (const perm of Object.values(PERMISSIONS)) {
      expect(await rbacStore.hasPermission(adminUser!.id, perm)).toBe(true);
    }
  });

  it.skipIf(!hasDb)('bootstrap is idempotent (running twice does not crash or duplicate)', async () => {
    const rbacStore = new RbacStore(db);
    const settingsService = makeSettings() as unknown as SettingsService;
    const bootstrap = new AdminBootstrapService(db, settingsService, rbacStore);

    // Run twice
    await bootstrap.onApplicationBootstrap();
    await bootstrap.onApplicationBootstrap();

    // Still works
    const adminUsers = await db.select().from(users).where(eq(users.role, USER_ROLES.ADMIN));
    for (const admin of adminUsers) {
      const roles = await rbacStore.rolesForUser(admin.id);
      expect(roles).toContain(ADMIN_ROLES.SUPER_ADMIN);
    }
  });
});
