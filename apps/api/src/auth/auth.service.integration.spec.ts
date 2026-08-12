/**
 * P1-6: Account Lifecycle & Session Security 真实 PostgreSQL 集成测试。
 * 覆盖：revoke one session / revoke all sessions / 已撤销 session 立即失效。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbFromPool, sessions, users, type Database } from '@enova/db';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { ERROR_CODES } from '@enova/contracts';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_auth_session_test';

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
  return { getString: async () => null, getNumber: async () => null, getBoolean: async () => false };
}
function makeTurnstile() {
  return { verify: async () => undefined, getConfig: async () => ({ enabled: false, siteKey: '' }) };
}

describe('AuthService sessions (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let auth: AuthService;

  beforeAll(async () => {
    if (!hasDb) return;
    await resetDatabase();
    ({ db, pool } = await applyMigrations());
    auth = new AuthService(
      db,
      makeSettings() as never,
      new PasswordService(),
      new SessionService(),
      makeTurnstile() as never,
    );
  }, 60000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it.skipIf(!hasDb)('registers a user and lists/revokes one session', async () => {
    const result = await auth!.register(`sess-${crypto.randomUUID()}@t.com`, 'password123', undefined, '1.2.3.4');
    const userId = result.user.userId;

    // 登录再用第二个 IP 产生第二个 session
    const result2 = await auth!.login(result.user.email, 'password123', undefined, '5.6.7.8');
    expect(result2.token).toBeTruthy();

    const all = await auth!.listSessions(userId);
    expect(all.length).toBe(2);

    // 撤销第一个 session
    await auth!.revokeSession(userId, all[0].id);
    const after = await auth!.listSessions(userId);
    expect(after.find((s) => s.id === all[0].id)?.revoked).toBe(true);
    expect(after.find((s) => s.id === all[1].id)?.revoked).toBe(false);
  });

  it.skipIf(!hasDb)('revoked session is immediately invalid', async () => {
    const result = await auth!.register(`sess2-${crypto.randomUUID()}@t.com`, 'password123');
    const userId = result.user.userId;
    const tokenHash = auth!.mustHashToken(result.token);

    const valid = await auth!.resolveSession(tokenHash);
    expect(valid).not.toBeNull();

    const sessionsList = await auth!.listSessions(userId);
    await auth!.revokeSession(userId, sessionsList[0].id);

    const invalid = await auth!.resolveSession(tokenHash);
    expect(invalid).toBeNull();
  });

  it.skipIf(!hasDb)('revoke-all keeps only the current session', async () => {
    const result = await auth!.register(`sess3-${crypto.randomUUID()}@t.com`, 'password123');
    const userId = result.user.userId;
    const keepHash = auth!.mustHashToken(result.token);

    // 再登录两次产生额外 session
    await auth!.login(result.user.email, 'password123');
    await auth!.login(result.user.email, 'password123');

    const revoked = await auth!.revokeAllOtherSessions(userId, keepHash);
    expect(revoked).toBe(2);

    // keep 的仍有效
    expect(await auth!.resolveSession(keepHash)).not.toBeNull();
    // 其它已撤销
    const rows = await db!.select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows.filter((s) => !s.revokedAt).length).toBe(1);
  });

  it.skipIf(!hasDb)('change-password rejects wrong current password', async () => {
    const result = await auth!.register(`sess4-${crypto.randomUUID()}@t.com`, 'password123');
    await expect(
      auth!.changePassword(result.user.userId, 'wrong-password', 'newpassword1'),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CREDENTIALS, statusCode: 401 });
  });
});