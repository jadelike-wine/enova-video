import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type IORedis from 'ioredis';
import { domainError, ERROR_CODES, type CredentialStatus } from '@enova/contracts';
import { providerCredentials, providers, type Database } from '@enova/db';
import { CredentialCrypto } from '../crypto.js';
import type { ProviderErrorCategory } from '../errors.js';
import type {
  AcquiredCredential,
  CredentialFailure,
  CredentialHealth,
  CredentialManager,
  CredentialSelectionCriteria,
} from '../credential-manager.interface.js';

/**
 * 基于 Redis lease / semaphore 的 Credential 管理器。
 *
 * 并发控制以 Redis 原子计数为准（多 Worker 可靠），杜绝仅用进程内 Map。
 * - acquire：按 priority/weight/LRU 选择候选，逐个用 Lua 原子占用并发槽位（带 TTL）。
 * - 无可用 credential 时抛 NO_AVAILABLE_CREDENTIAL（transient）。
 * - markFailure：429 → 冷却；401/403 → ERROR（降级）；其它 transient → 仅记录。
 * - 成功：重置退避/冷却，记录 last_used_at。
 * - Secret 仅解密到当前调用内存，绝不落日志/进入错误信息。
 */

const ACQUIRE_LEASE_SCRIPT = `
local cur = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
if cur > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

const RELEASE_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur == false then
  return 0
end
cur = tonumber(cur)
if cur <= 1 then
  redis.call('DEL', KEYS[1])
  return cur
end
redis.call('DECR', KEYS[1])
return cur - 1
`;

export interface RedisCredentialManagerOptions {
  db: Database;
  redis: IORedis;
  crypto: CredentialCrypto;
  /** 并发 lease TTL（毫秒），Worker 崩溃后槽位自动归还。 */
  leaseTtlMs?: number;
  /** 401/403 后降级为 ERROR（不自动恢复，需人工/健康检测恢复）。 */
}

const DEFAULT_LEASE_TTL = 120_000;

export class RedisCredentialManager implements CredentialManager {
  private readonly leaseTtlMs: number;

  constructor(private readonly opts: RedisCredentialManagerOptions) {
    this.leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL;
  }

  async acquire(criteria: CredentialSelectionCriteria): Promise<AcquiredCredential> {
    const rows = await this.selectCandidates(criteria.providerCode);
    if (rows.length === 0) {
      throw this.noAvailable('no active credential');
    }

    // 候选已按 priority DESC / weight DESC / last_used_at ASC 排序。
    for (const row of rows) {
      const ok = await this.tryReserveLease(row.credentialId, row.maxConcurrency);
      if (!ok) continue;
      try {
        const secret = this.opts.crypto.decrypt(row.encryptedSecret);
        await this.touchUsed(row.credentialId);
        return {
          credentialId: row.credentialId,
          providerCode: row.providerCode,
          secret,
          release: () => this.doRelease(row.credentialId),
        };
      } catch (err) {
        // 解密或 DB 更新失败：归还槽位并继续尝试下一个。
        await this.doRelease(row.credentialId);
        throw err;
      }
    }
    throw this.noAvailable('all credentials busy/cooldown');
  }

  async markSuccess(credentialId: string, _providerCode: string): Promise<void> {
    await this.opts.db
      .update(providerCredentials)
      .set({
        status: 'ACTIVE',
        cooldownUntil: null,
        lastError: null,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(providerCredentials.id, credentialId));
  }

  async markFailure(credentialId: string, _providerCode: string, failure: CredentialFailure): Promise<void> {
    const now = new Date();
    const set: Record<string, unknown> = { updatedAt: now };

    if (failure.category === 'RATE_LIMITED') {
      const ms = failure.retryAfterMs ?? 0;
      const cooldownMs = ms > 0 ? ms : defaultBackoffMs();
      set.status = 'COOLDOWN';
      set.cooldownUntil = new Date(now.getTime() + cooldownMs);
      set.lastError = sanitizedError(failure);
    } else if (failure.category === 'AUTH_ERROR') {
      set.status = 'ERROR';
      set.lastError = sanitizedError(failure);
    } else {
      // 其它 transient / bad request：不影响可用性，仅记录。
      set.lastError = sanitizedError(failure);
    }

    await this.opts.db
      .update(providerCredentials)
      .set(set)
      .where(eq(providerCredentials.id, credentialId));
  }

  async health(criteria: CredentialSelectionCriteria): Promise<CredentialHealth[]> {
    const rows = await this.selectCandidates(criteria.providerCode, { includeNonActive: true });
    return Promise.all(
      rows.map(async (r) => ({
        credentialId: r.credentialId,
        status: r.status as CredentialStatus,
        currentConcurrency: await this.currentConcurrency(r.credentialId),
        maxConcurrency: r.maxConcurrency,
        cooldownUntil: r.cooldownUntil ?? undefined,
        lastUsedAt: r.lastUsedAt ?? undefined,
        lastError: r.lastError ?? undefined,
      })),
    );
  }

  async invalidate(_providerCode: string): Promise<void> {
    // Redis lease 无本地缓存需刷新；预留。
  }

  // ---- internals ----

  private async selectCandidates(
    providerCode: string,
    opts: { includeNonActive?: boolean } = {},
  ): Promise<
    Array<{
      credentialId: string;
      providerCode: string;
      encryptedSecret: string;
      status: string;
      maxConcurrency: number;
      cooldownUntil?: Date | null;
      lastUsedAt?: Date | null;
      lastError?: string | null;
    }>
  > {
    const activeFilter = opts.includeNonActive
      ? undefined
      : and(
          eq(providerCredentials.status, 'ACTIVE'),
          or(isNull(providerCredentials.cooldownUntil), sql`${providerCredentials.cooldownUntil} <= now()`),
        );

    const rows = await this.opts.db
      .select({
        credentialId: providerCredentials.id,
        providerCode: providers.code,
        encryptedSecret: providerCredentials.encryptedSecret,
        status: providerCredentials.status,
        maxConcurrency: providerCredentials.maxConcurrency,
        cooldownUntil: providerCredentials.cooldownUntil,
        lastUsedAt: providerCredentials.lastUsedAt,
        lastError: providerCredentials.lastError,
      })
      .from(providerCredentials)
      .innerJoin(providers, eq(providers.id, providerCredentials.providerId))
      .where(and(eq(providers.code, providerCode), activeFilter))
      .orderBy(
        desc(providerCredentials.priority),
        desc(providerCredentials.weight),
        asc(providerCredentials.lastUsedAt),
      );

    return (rows as unknown as Array<{
      credentialId: string;
      providerCode: string;
      encryptedSecret: string;
      status: string;
      maxConcurrency: number;
      cooldownUntil?: Date | null;
      lastUsedAt?: Date | null;
      lastError?: string | null;
    }>).map((r) => ({ ...r, status: String(r.status) }));
  }

  private leaseKey(credentialId: string): string {
    return `enova:credential:${credentialId}:concurrency`;
  }

  private async tryReserveLease(credentialId: string, maxConcurrency: number): Promise<boolean> {
    const ttlSeconds = Math.max(1, Math.floor(this.leaseTtlMs / 1000));
    const res = await this.opts.redis.eval(ACQUIRE_LEASE_SCRIPT, 1, this.leaseKey(credentialId), String(ttlSeconds), String(maxConcurrency));
    return res === 1;
  }

  private async doRelease(credentialId: string): Promise<void> {
    await this.opts.redis.eval(RELEASE_SCRIPT, 1, this.leaseKey(credentialId));
  }

  private async currentConcurrency(credentialId: string): Promise<number> {
    const v = await this.opts.redis.get(this.leaseKey(credentialId));
    return v ? Number(v) : 0;
  }

  private async touchUsed(credentialId: string): Promise<void> {
    await this.opts.db
      .update(providerCredentials)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(providerCredentials.id, credentialId));
  }

  private noAvailable(reason: string): Error {
    return domainError(ERROR_CODES.NO_AVAILABLE_CREDENTIAL, `No available credential: ${reason}`, 503);
  }
}

/** 429 无 Retry-After 时的指数退避（毫秒）。 */
function defaultBackoffMs(): number {
  const base = [2000, 5000, 10000, 20000][Math.floor(Math.random() * 4)];
  return base + Math.floor(Math.random() * 500);
}

/** 只记录归类的简短错误摘要，绝不包含 secret / 完整响应。 */
function sanitizedError(failure: CredentialFailure): string {
  const msg = failure.message?.slice(0, 200) ?? failure.category;
  return `${failure.category}: ${msg}`;
}

export type { ProviderErrorCategory };