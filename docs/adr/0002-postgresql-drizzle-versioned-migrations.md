# ADR-0002: PostgreSQL 16 + Drizzle ORM with Versioned Migrations

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The billing wallet system requires:

- **Row-level locking** (`SELECT ... FOR UPDATE`) to prevent concurrent oversell of credits.
- **CHECK constraints** to enforce `captured + released <= reserved` at the database level.
- **Unique indexes** for idempotency keys to prevent duplicate reserve/settle/release.
- **Transactional integrity** so that wallet updates, ledger entries, and reservation rows commit atomically.

The previous architecture used SQLite, which lacks `FOR UPDATE` row locks, has limited concurrency support, and does not support the needed transactional guarantees for a financial-grade billing system.

## Decision

Use **PostgreSQL 16** as the primary database and **Drizzle ORM** for schema definition and migrations.

- Schema is defined in `packages/db/src/schema.ts`.
- Versioned migrations live in `packages/db/drizzle/` (currently 0000–0011).
- API auto-runs migrations on startup (idempotent; failure → exit → health check fails → auto rollback).
- Money is stored as integers: credits as bigint, costs as micro-USD (1e-6 USD), payments as cents.

## Alternatives Considered

1. **SQLite (keep existing)** — Rejected: no `FOR UPDATE`, no concurrent writer support, no reliable unique constraint behavior under the billing system's concurrency requirements.
2. **Prisma ORM** — Considered but not chosen. Drizzle provides a thinner abstraction, raw SQL escape hatches (needed for `FOR UPDATE SKIP LOCKED` in the outbox dispatcher), and better control over query shapes. The codebase uses `tx.execute(sql\`...\`)` in `outbox.dispatcher.ts` where Drizzle's typed builder doesn't support `SKIP LOCKED`.
3. **TypeORM** — Rejected: heavier, less type-safe migration workflow, and the NestJS ecosystem doesn't require it when Drizzle provides full TypeScript type inference.

## Consequences

**Positive:**
- Full PostgreSQL feature set: row locks, CHECK constraints, unique indexes, `FOR UPDATE SKIP LOCKED`.
- Integer money arithmetic avoids floating-point errors.
- Migration files are SQL-first, reviewable, and version-controlled.
- Drizzle's type inference gives compile-time schema safety.

**Negative:**
- Drizzle's `.for()` method doesn't accept `'update skip locked'` — the codebase uses raw SQL for those queries.
- Migration snapshots in `meta/` can be large and must be committed alongside SQL files.

## Risks

- Schema changes that skip migration generation (`pnpm db:generate`) will fail in production startup.
- Raw SQL escape hatches bypass Drizzle's type safety.

## Follow-ups

- `AGENTS.md` mandates: "schema 改动必须通过 Drizzle migration; 不要只改 schema.ts 而跳过 migration."
- CI validates production Docker Compose config (including DB env vars) in `ci.yml`.

## References

- [packages/db/src/schema.ts](../../packages/db/src/schema.ts) — Schema definitions
- [packages/db/drizzle/](../../packages/db/drizzle/) — Migration files (0000–0011)
- [packages/billing/src/wallet.ts](../../packages/billing/src/wallet.ts) — `FOR UPDATE` usage
- [apps/api/src/generations/outbox.dispatcher.ts](../../apps/api/src/generations/outbox.dispatcher.ts) — `FOR UPDATE SKIP LOCKED` raw SQL
- [README.md](../../README.md) §数据库 — Table overview and money conventions
- Commit `0a82075` — SaaS backend rewrite with Drizzle
