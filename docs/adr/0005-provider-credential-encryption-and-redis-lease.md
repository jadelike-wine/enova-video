# ADR-0005: Provider Credential Encryption (AES-GCM) and Redis-Based Concurrency Lease

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The system calls upstream AI providers (currently Agnes) using API keys that must be:

1. **Encrypted at rest** — plaintext secrets must never be stored in the database or logs.
2. **Concurrency-limited across Worker instances** — each credential has a `maxConcurrency` setting; multiple Worker processes must respect this limit atomically.
3. **Failure-aware** — a 429 (rate limit) should put the credential in cooldown; a 401/403 should degrade it to `ERROR`; other transient errors should be logged without disabling.
4. **Lease-safe** — if a Worker crashes mid-task, the concurrency slot must be automatically returned.

## Decision

### Credential encryption

- Provider secrets are encrypted with **AES-256-GCM** using a `CREDENTIAL_MASTER_KEY` (32-byte hex or base64).
- Encryption/decryption is handled by `CredentialCrypto` in `packages/provider/src/crypto.ts`.
- The master key is injected via environment variable or IAM/Role — **never** stored in the database.
- In production, `.env.example` dev placeholder keys are forbidden.

### Concurrency control

- Use **Redis atomic Lua scripts** with an owner-token ZSET for concurrency slot management.
- `RedisCredentialManager` in `packages/provider/src/credential-manager/redis-credential-manager.ts`:
  - `acquire()`: removes expired owners, checks `ZCARD`, and atomically adds a unique owner token when capacity remains.
  - Active calls renew only their own token; long provider calls therefore keep their slot without extending stale owners.
  - `release()`: removes only the caller's owner token and is idempotent, so a duplicate/stale release cannot return another Worker's slot.
  - Per-owner expiry (default 120s) ensures slots are returned if the Worker crashes.
- Credential status transitions: `ACTIVE` → `COOLDOWN` (on 429, with `retryAfterMs` or exponential backoff) → auto-recovery; `ACTIVE` → `ERROR` (on 401/403, requires manual/health-check recovery).

### Secret hygiene

- Decrypted secrets exist only in memory during the provider call.
- `sanitizedError()` truncates error messages to 200 chars and strips any secret content before logging.
- `lastError` in the database contains only the category + truncated message.

## Alternatives Considered

1. **In-process `Map` for concurrency** — Rejected: fails across multiple Worker instances. The AGENTS.md invariant explicitly states: "Redis 上的凭证并发控制是跨 worker 的一致性边界, 不能退化为进程内 Map."
2. **Database row-level locks for concurrency** — Rejected: DB locks are connection-scoped and don't survive process crashes gracefully. Redis TTL provides automatic lease expiry.
3. **Plaintext secrets in DB** — Rejected: unacceptable security risk.
4. **Environment-variable-only credentials (no DB)** — Rejected: the admin console needs to manage credentials at runtime without restarting the API/Worker.

## Consequences

**Positive:**
- Secrets are encrypted at rest with AES-GCM.
- Concurrency control is atomic across Worker instances.
- Crashed Workers' slots auto-expire via TTL.
- 429 cooldowns are automatic; 401/403 degradation prevents cascading auth failures.

**Negative:**
- Redis must be available for credential acquisition — if Redis is down, no credentials can be acquired (fail-closed).
- The Lua scripts must be correct — a bug in the acquire/release script could leak slots or allow over-concurrency.
- Master key rotation requires re-encrypting all secrets.

## Risks

- Redis failure blocks all generation tasks (fail-closed by design).
- Lease TTL must be tuned: too short increases heartbeat sensitivity; too long delays recovery of slots held by crashed Workers.
- Master key leakage is catastrophic — it must never be logged, committed, or stored in the database.

## Follow-ups

- `AGENTS.md` invariant: "provider 凭证使用 CREDENTIAL_MASTER_KEY 加密; 生产环境禁止使用 .env.example 中的 dev 占位密钥."
- `AGENTS.md` invariant: "生产环境的 CREDENTIAL_MASTER_KEY、数据库和 Redis 只能通过服务端环境或 IAM/角色注入."
- System Settings for credential lease TTL and retry attempts are dynamically configurable.

## References

- [packages/provider/src/credential-manager/redis-credential-manager.ts](../../packages/provider/src/credential-manager/redis-credential-manager.ts) — Redis lease implementation
- [packages/provider/src/crypto.ts](../../packages/provider/src/crypto.ts) — AES-GCM encryption
- [packages/provider/src/__tests__/credential-manager.test.ts](../../packages/provider/src/__tests__/credential-manager.test.ts) — Concurrency and failure tests
- [.env.example](../../.env.example) — `CREDENTIAL_MASTER_KEY` documentation
- [AGENTS.md](../../AGENTS.md) — Security invariants
- [docs/product-reference.md](../product-reference.md) §5.3 — Access and security boundaries
