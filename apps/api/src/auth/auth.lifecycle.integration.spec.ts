/**
 * Auth Lifecycle 真实 PostgreSQL 集成测试。
 * 覆盖：password reset（token hash / 单次使用 / 过期 / 撤销 session）/
 * email verification（创建 / 验证 / 重放 / 过期）/ session management（撤销其它 /
 * 改密保留当前 / 全撤销 / 跨用户拒绝 / 不泄露 tokenHash）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbFromPool, sessions, users, passwordResetTokens, emailVerificationTokens, type Database } from '@enova/db';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { ERROR_CODES } from '@enova/contracts';

const connectionString = process.env.DATABASE_URL;
const hasDb = !!connectionString;
const TEST_DB = 'enova_auth_lifecycle_test';

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

describe('Auth Lifecycle (real PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let auth: AuthService;
  const session = new SessionService();

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

  // ---- Password Reset ----

  it.skipIf(!hasDb)('forgot-password creates token hash (not plaintext)', async () => {
    const result = await auth.register(`pw-${crypto.randomUUID()}@t.com`, 'password123');
    const token = await auth.requestPasswordReset(result.user.email);
    expect(token).toBeTruthy();
    // DB should only have hash, not plaintext
    const rows = await db.select().from(passwordResetTokens);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.tokenHash).not.toBe(token);
  });

  it.skipIf(!hasDb)('forgot-password returns null for unknown email', async () => {
    const token = await auth.requestPasswordReset('nonexistent@test.com');
    expect(token).toBeNull();
  });

  it.skipIf(!hasDb)('reset-password succeeds with valid token', async () => {
    const result = await auth.register(`pw2-${crypto.randomUUID()}@t.com`, 'password123');
    const token = await auth.requestPasswordReset(result.user.email);
    await auth.resetPassword(token!, 'newpassword456');
    // Can login with new password
    const loginResult = await auth.login(result.user.email, 'newpassword456');
    expect(loginResult.token).toBeTruthy();
  });

  it.skipIf(!hasDb)('reset-token is single-use', async () => {
    const result = await auth.register(`pw3-${crypto.randomUUID()}@t.com`, 'password123');
    const token = await auth.requestPasswordReset(result.user.email);
    await auth.resetPassword(token!, 'newpassword456');
    // Second use should fail
    await expect(auth.resetPassword(token!, 'another789')).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CREDENTIALS });
  });

  it.skipIf(!hasDb)('expired reset token fails', async () => {
    const result = await auth.register(`pw4-${crypto.randomUUID()}@t.com`, 'password123');
    // Insert an expired token directly
    const rawToken = session.issueToken();
    const tokenHash = session.hashToken(rawToken);
    await db.insert(passwordResetTokens).values({
      userId: result.user.userId,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    await expect(auth.resetPassword(rawToken, 'newpassword456')).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CREDENTIALS });
  });

  it.skipIf(!hasDb)('reset-password revokes all old sessions', async () => {
    const result = await auth.register(`pw5-${crypto.randomUUID()}@t.com`, 'password123');
    const tokenHash = auth.mustHashToken(result.token);
    // Session should be valid
    expect(await auth.resolveSession(tokenHash)).not.toBeNull();
    // Reset password
    const resetToken = await auth.requestPasswordReset(result.user.email);
    await auth.resetPassword(resetToken!, 'newpassword456');
    // Old session should be revoked
    expect(await auth.resolveSession(tokenHash)).toBeNull();
  });

  // ---- Email Verification ----

  it.skipIf(!hasDb)('register creates email verification token', async () => {
    const result = await auth.register(`ev-${crypto.randomUUID()}@t.com`, 'password123');
    const tokens = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, result.user.userId));
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.tokenHash).toBeTruthy();
    expect(tokens[0]!.usedAt).toBeNull();
  });

  it.skipIf(!hasDb)('verify-email sets emailVerifiedAt', async () => {
    const result = await auth.register(`ev2-${crypto.randomUUID()}@t.com`, 'password123');
    // DB only stores hash; create a new verifiable token.
    const rawToken = await auth.createEmailVerificationToken(result.user.userId);
    await auth.verifyEmail(rawToken);
    const userRows = await db.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, result.user.userId));
    expect(userRows[0]!.emailVerifiedAt).not.toBeNull();
  });

  it.skipIf(!hasDb)('verify-email replay fails', async () => {
    const result = await auth.register(`ev3-${crypto.randomUUID()}@t.com`, 'password123');
    const rawToken = await auth.createEmailVerificationToken(result.user.userId);
    await auth.verifyEmail(rawToken);
    await expect(auth.verifyEmail(rawToken)).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CREDENTIALS });
  });

  it.skipIf(!hasDb)('verify-email expired fails', async () => {
    const result = await auth.register(`ev4-${crypto.randomUUID()}@t.com`, 'password123');
    const rawToken = session.issueToken();
    const tokenHash = session.hashToken(rawToken);
    await db.insert(emailVerificationTokens).values({
      userId: result.user.userId,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(auth.verifyEmail(rawToken)).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CREDENTIALS });
  });

  // ---- Session Management ----

  it.skipIf(!hasDb)('revoke-others does not revoke current session', async () => {
    const result = await auth.register(`sess-r-${crypto.randomUUID()}@t.com`, 'password123');
    const keepHash = auth.mustHashToken(result.token);
    await auth.login(result.user.email, 'password123');
    await auth.login(result.user.email, 'password123');
    const revoked = await auth.revokeAllOtherSessions(result.user.userId, keepHash);
    expect(revoked).toBe(2);
    expect(await auth.resolveSession(keepHash)).not.toBeNull();
  });

  it.skipIf(!hasDb)('change-password revokes other sessions', async () => {
    const result = await auth.register(`cp-${crypto.randomUUID()}@t.com`, 'password123');
    const keepHash = auth.mustHashToken(result.token);
    // Create another session
    await auth.login(result.user.email, 'password123');
    // Change password, keeping current session
    await auth.changePassword(result.user.userId, 'password123', 'newpassword456', keepHash);
    // Current session should still work
    expect(await auth.resolveSession(keepHash)).not.toBeNull();
    // Old sessions should be revoked (check via listSessions)
    const allSessions = await auth.listSessions(result.user.userId);
    const activeCount = allSessions.filter((s) => !s.revoked).length;
    expect(activeCount).toBe(1);
  });

  it.skipIf(!hasDb)('revoke-all sessions works', async () => {
    const result = await auth.register(`ra-${crypto.randomUUID()}@t.com`, 'password123');
    const tokenHash = auth.mustHashToken(result.token);
    await auth.login(result.user.email, 'password123');
    await auth.revokeAllSessions(result.user.userId);
    // All sessions should be revoked
    expect(await auth.resolveSession(tokenHash)).toBeNull();
  });

  it.skipIf(!hasDb)('user cannot revoke another user\'s session', async () => {
    const result1 = await auth.register(`u1-${crypto.randomUUID()}@t.com`, 'password123');
    const result2 = await auth.register(`u2-${crypto.randomUUID()}@t.com`, 'password123');
    const sessions1 = await auth.listSessions(result1.user.userId);
    // User 2 tries to revoke user 1's session
    await expect(auth.revokeSession(result2.user.userId, sessions1[0]!.id)).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it.skipIf(!hasDb)('session API does not return tokenHash', async () => {
    const result = await auth.register(`th-${crypto.randomUUID()}@t.com`, 'password123');
    const sessionsList = await auth.listSessions(result.user.userId);
    const s = sessionsList[0]!;
    expect(s).not.toHaveProperty('tokenHash');
    expect(s).toHaveProperty('id');
    expect(s).toHaveProperty('ip');
    expect(s).toHaveProperty('createdAt');
    expect(s).toHaveProperty('expiresAt');
    expect(s).toHaveProperty('revoked');
  });
});
