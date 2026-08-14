# ADR-0001: Modular Monolith Monorepo — apps/ + packages/

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

EnovaMotion needs three independent runtime processes (API, Worker, Web) that share domain logic, type contracts, and configuration. A microservices approach would introduce inter-service network calls and deployment complexity for a small team. A traditional single-process monolith would not allow the Worker to scale independently from the API or run with different concurrency settings.

The previous architecture used FastAPI + SQLite (`backend/`) and a separate `frontend/` directory. That approach had coupling issues and was deleted in commit `b3480db`.

## Decision

Adopt a **modular monolith monorepo** with a single codebase split into:

- `apps/api` — NestJS + Fastify API server (auth, generations, billing, payment, admin)
- `apps/worker` — BullMQ consumer (provider calls, polling, storage, settlement)
- `apps/web` — Next.js 15 frontend
- `packages/*` — Shared domain logic, contracts, DB, config, provider, billing, payment, SDK

Three processes are independently deployable as Docker containers but share the same codebase and TypeScript types.

## Alternatives Considered

1. **Microservices** — Rejected: too much operational overhead for the current team size and deployment model (single EC2 instance).
2. **Single-process monolith** — Rejected: the Worker needs to consume BullMQ queues, poll video providers, and download/transfer large media files independently of the API's request handling.
3. **Keep old FastAPI + SQLite** — Rejected: SQLite lacks the concurrency, row-level locking, and transactional guarantees needed for the billing wallet system. FastAPI's async model didn't match the NestJS ecosystem chosen for the new architecture.

## Consequences

**Positive:**
- Shared types eliminate contract drift between API and Worker.
- Domain logic in `packages/*` is testable without NestJS.
- Each process can scale and be deployed independently.
- Single `pnpm` workspace simplifies dependency management.

**Negative:**
- Changes to `packages/contracts` require rebuilding dependent packages.
- CI must build pure TS packages before typecheck/test (see `ci.yml`).
- No physical boundary enforcement — a developer could accidentally import API-specific code into a package.

## Risks

- Package boundary violations (importing NestJS into pure domain packages).
- Build order sensitivity — workspace packages without `dist` cause typecheck failures in fresh CI checkouts.

## Follow-ups

- The CI pipeline pre-builds `packages/*` before running typecheck (see `.github/workflows/ci.yml` step "Build packages").
- ADR-0009 documents the NestJS-agnostic constraint for domain packages.

## References

- [AGENTS.md](../../AGENTS.md) — Directory responsibilities
- [README.md](../../README.md) — Architecture overview
- Commit `0a82075` — "完成 SaaS 后端重构（Monorepo + NestJS + Drizzle + BullMQ）"
- Commit `b3480db` — "移除旧架构 backend/frontend 并同步文档至新架构"
- [docs/product-reference.md](../product-reference.md) §8 — Architecture mapping
