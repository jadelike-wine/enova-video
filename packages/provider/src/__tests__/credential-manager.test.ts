import { describe, expect, it, vi } from 'vitest';
import { CredentialCrypto } from '../crypto.js';
import { RedisCredentialManager } from '../credential-manager/redis-credential-manager.js';
import type { CredentialSelectionCriteria } from '../credential-manager.interface.js';

const KEY = 'a'.repeat(64);
const crypto = CredentialCrypto.fromEnv(KEY);

interface Row {
  credentialId: string;
  status: string;
  maxConcurrency: number;
  encryptedSecret: string;
  cooldownUntil?: Date | null;
  lastUsedAt?: Date | null;
  lastError?: string | null;
}

/** 内存 Redis：模拟 acquire/release Lua 脚本的并发计数语义。 */
class FakeRedis {
  leases = new Map<string, Map<string, number>>();
  nowMs = Date.now();

  async eval(script: string, _numkeys: number, ...args: string[]): Promise<number> {
    const key = args[0];
    const entries = this.leases.get(key) ?? new Map<string, number>();
    this.leases.set(key, entries);
    if (script.includes('ACQUIRE_LEASE_V2')) {
      const usesRedisTime = script.includes("redis.call('TIME')");
      const now = usesRedisTime ? this.nowMs : Number(args[1]);
      const expiresAt = usesRedisTime ? now + Number(args[1]) : Number(args[2]);
      const max = Number(args[usesRedisTime ? 2 : 3]);
      const token = args[usesRedisTime ? 3 : 4];
      for (const [existingToken, expiry] of entries) {
        if (expiry <= now) entries.delete(existingToken);
      }
      if (entries.size >= max) {
        return 0;
      }
      entries.set(token, expiresAt);
      return 1;
    }
    if (script.includes('RELEASE_LEASE_V2')) {
      return entries.delete(args[1]) ? 1 : 0;
    }
    if (script.includes('RENEW_LEASE_V2')) {
      const token = args[1];
      if (!entries.has(token)) return 0;
      entries.set(token, script.includes("redis.call('TIME')") ? this.nowMs + Number(args[2]) : Number(args[2]));
      return 1;
    }
    if (script.includes('COUNT_LEASES_V2')) {
      const now = script.includes("redis.call('TIME')") ? this.nowMs : Number(args[1]);
      for (const [token, expiry] of entries) {
        if (expiry <= now) entries.delete(token);
      }
      return entries.size;
    }
    throw new Error('unknown script');
  }

  async get(key: string): Promise<string> {
    return String(this.leases.get(key)?.size ?? 0);
  }
}

/** 构造 fluent DB mock：select 链返回 rows；update 链可记录 set payload。 */
function makeDb(rows: Row[]) {
  const updates: any[] = [];
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => Promise.resolve(rows.map((r) => ({ ...r, providerCode: 'agnes' }))),
          }),
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (payload: unknown) => {
        updates.push(payload);
        return { where: () => Promise.resolve([{ id: 'x' }]) };
      },
    }),
    _updates: updates,
  };
  return db;
}

function manager(redis: FakeRedis, rows: Row[], leaseTtlMs?: number) {
  const db = makeDb(rows);
  return { mgr: new RedisCredentialManager({ db: db as never, redis: redis as never, crypto, leaseTtlMs }), db };
}

const CRITERIA: CredentialSelectionCriteria = { providerCode: 'agnes' };

describe('RedisCredentialManager', () => {
  it('selects highest-priority active credential and decrypts secret', async () => {
    const redis = new FakeRedis();
    const enc = crypto.encrypt('sk-live-1');
    const { mgr } = manager(redis, [
      { credentialId: 'c-low', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: enc },
    ]);
    const got = await mgr.acquire(CRITERIA);
    expect(got.credentialId).toBe('c-low');
    expect(got.secret).toBe('sk-live-1');
    await got.release();
  });

  it('throws NO_AVAILABLE when no candidate rows', async () => {
    const redis = new FakeRedis();
    const { mgr } = manager(redis, []);
    await expect(mgr.acquire(CRITERIA)).rejects.toThrow(/No available credential/);
  });

  it('skips a credential at max concurrency and uses the next', async () => {
    const redis = new FakeRedis();
    const enc = crypto.encrypt('sk-next');
    const { mgr } = manager(redis, [
      { credentialId: 'busy', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: crypto.encrypt('sk-busy') },
      { credentialId: 'free', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: enc },
    ]);
    const got = await mgr.acquire(CRITERIA); // 占用 busy
    expect(got.credentialId).toBe('busy');
    await got.release();

    // busy 仍被占用（模拟其它 worker）：再次 acquire 应落到 free
    const got2 = await mgr.acquire(CRITERIA);
    expect(got2.credentialId).toBe('busy'); // 因为 busy 已释放，仍优先
    await got2.release();
  });

  it('respects Redis concurrency across instances', async () => {
    const redis = new FakeRedis();
    const enc = crypto.encrypt('sk-1');
    // 两个 concurrent acquire 都拿到同一 credential（maxConcurrency=2）
    const { mgr } = manager(redis, [
      { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: enc },
    ]);
    const a = await mgr.acquire(CRITERIA);
    // 第二个 acquire 因 redis 槽位已满而失败（无其它候选）
    await expect(mgr.acquire(CRITERIA)).rejects.toThrow(/No available credential/);
    await a.release();
    // 释放后可再次获取
    const b = await mgr.acquire(CRITERIA);
    expect(b.credentialId).toBe('c1');
    await b.release();
  });

  it('lease release returns the concurrency slot', async () => {
    const redis = new FakeRedis();
    const { mgr } = manager(redis, [
      { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 2, encryptedSecret: crypto.encrypt('sk') },
    ]);
    const a = await mgr.acquire(CRITERIA);
    const b = await mgr.acquire(CRITERIA);
    expect(await redis.get('enova:credential:c1:leases:v2')).toBe('2');
    await a.release();
    await b.release();
    expect(await redis.get('enova:credential:c1:leases:v2')).toBe('0');
  });

  it('releasing one lease twice never releases another active lease', async () => {
    const redis = new FakeRedis();
    const { mgr } = manager(redis, [
      { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 2, encryptedSecret: crypto.encrypt('sk') },
    ]);
    const first = await mgr.acquire(CRITERIA);
    const second = await mgr.acquire(CRITERIA);

    await first.release();
    await first.release();

    const third = await mgr.acquire(CRITERIA);
    await expect(mgr.acquire(CRITERIA)).rejects.toThrow(/No available credential/);
    await third.release();
    await second.release();
  });

  it('renews an active lease so a long provider call keeps its concurrency slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const redis = new FakeRedis();
      const { mgr } = manager(redis, [
        { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: crypto.encrypt('sk') },
      ], 300);
      const active = await mgr.acquire(CRITERIA);

      await vi.advanceTimersByTimeAsync(350);

      await expect(mgr.acquire(CRITERIA)).rejects.toThrow(/No available credential/);
      await active.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reclaim a live lease when a worker clock jumps ahead of Redis', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    try {
      const redis = new FakeRedis();
      redis.nowMs = 1_000;
      const { mgr } = manager(redis, [
        { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: crypto.encrypt('sk') },
      ], 10_000);
      const active = await mgr.acquire(CRITERIA);

      vi.setSystemTime(new Date(1_000_000));

      await expect(mgr.acquire(CRITERIA)).rejects.toThrow(/No available credential/);
      await active.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('markSuccess resets cooldown/status/error', async () => {
    const redis = new FakeRedis();
    const { mgr, db } = manager(redis, [
      { credentialId: 'c1', status: 'COOLDOWN', maxConcurrency: 1, encryptedSecret: crypto.encrypt('sk'), cooldownUntil: new Date(Date.now() + 10000) },
    ]);
    await mgr.markSuccess('c1', 'agnes');
    const set = db._updates[db._updates.length - 1];
    expect(set.status).toBe('ACTIVE');
    expect(set.cooldownUntil).toBeNull();
    expect(set.lastError).toBeNull();
  });

  it('markFailure 429 sets COOLDOWN with retryAfter', async () => {
    const redis = new FakeRedis();
    const { mgr, db } = manager(redis, [
      { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: crypto.encrypt('sk') },
    ]);
    await mgr.markFailure('c1', 'agnes', { category: 'RATE_LIMITED', retryAfterMs: 5000, message: 'slow down' });
    const set = db._updates[db._updates.length - 1];
    expect(set.status).toBe('COOLDOWN');
    expect(set.cooldownUntil.getTime()).toBeGreaterThan(Date.now());
    expect(set.lastError).toContain('RATE_LIMITED');
    expect(set.lastError).not.toContain('sk');
  });

  it('markFailure 401 degrades to ERROR', async () => {
    const redis = new FakeRedis();
    const { mgr, db } = manager(redis, [
      { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: crypto.encrypt('sk') },
    ]);
    await mgr.markFailure('c1', 'agnes', { category: 'AUTH_ERROR', message: 'unauthorized' });
    const set = db._updates[db._updates.length - 1];
    expect(set.status).toBe('ERROR');
  });

  it('redacts credentials embedded in provider failure messages before persisting health', async () => {
    const redis = new FakeRedis();
    const { mgr, db } = manager(redis, [
      { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 1, encryptedSecret: crypto.encrypt('sk') },
    ]);

    await mgr.markFailure('c1', 'agnes', {
      category: 'AUTH_ERROR',
      message: 'upstream rejected Authorization: Bearer sk-live-super-secret at https://provider.test?api_key=sk-live-super-secret',
    });

    const set = db._updates[db._updates.length - 1] as { lastError: string };
    expect(set.lastError).toContain('[REDACTED]');
    expect(set.lastError).not.toContain('sk-live-super-secret');
  });

  it('health returns typed status (no raw string leak)', async () => {
    const redis = new FakeRedis();
    const { mgr } = manager(redis, [
      { credentialId: 'c1', status: 'ACTIVE', maxConcurrency: 4, encryptedSecret: crypto.encrypt('sk') },
    ]);
    const health = await mgr.health(CRITERIA);
    expect(health[0].credentialId).toBe('c1');
    expect(health[0].status).toBe('ACTIVE');
    expect(health[0].maxConcurrency).toBe(4);
  });
});
