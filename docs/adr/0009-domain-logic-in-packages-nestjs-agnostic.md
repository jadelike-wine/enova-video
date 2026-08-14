# ADR-0009: Domain Logic in packages/* (NestJS-Agnostic)

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The monorepo has three processes (API, Worker, Web) that need to share business logic. If domain logic lives inside the NestJS API module, the Worker cannot import it without pulling in the entire NestJS runtime. This creates:

1. **Circular dependency risk**: Worker depends on API modules that depend on Worker types.
2. **Test isolation**: domain logic tests would require NestJS bootstrap.
3. **Deployment bloat**: the Worker Docker image would need NestJS dependencies.

## Decision

Place **pure domain logic** in `packages/*` with no NestJS dependencies. The API and Worker import from these packages.

### Boundary rules

| Layer | Location | NestJS dependency? | Examples |
|-------|----------|-------------------|----------|
| Domain logic | `packages/billing`, `packages/provider`, `packages/payment` | No | `WalletGateway`, `CredentialManager`, `PaymentAdapter` |
| Shared contracts | `packages/contracts` | No | Types, enums, error codes, queue payloads |
| Database schema | `packages/db` | No | Drizzle schema, client, migrations |
| API modules | `apps/api/src/*` | Yes (NestJS) | Controllers, services that orchestrate domain packages |
| Worker pipeline | `apps/worker/src/*` | No (standalone) | `GenerationPipeline`, processors |

### Key examples

- `WalletGateway` in `packages/billing/src/wallet.ts`: accepts a `Database` (Drizzle) type, uses `db.transaction()`, and can be instantiated directly without NestJS DI. Both API and Worker use it.
- `RedisCredentialManager` in `packages/provider/src/credential-manager/redis-credential-manager.ts`: accepts `Database` and `IORedis`, no NestJS imports.
- `GenerationPipeline` in `apps/worker/src/generation/pipeline.ts`: constructed with plain dependency injection (object literal), no NestJS module.
- API controllers in `apps/api/src/` use NestJS DI to inject `WalletService`, `SettingsService`, etc., which in turn wrap the pure domain packages.

### ESM import convention

TypeScript source uses ESM relative imports with `.js` suffix (e.g., `import { WalletGateway } from '@enova/billing'` in API/Worker; `import { computeReserve } from './compute.js'` within packages). This matches the `tsconfig` module resolution and compiled output.

## Alternatives Considered

1. **All logic in `apps/api/src/`** — Rejected: Worker would need to import NestJS modules, creating circular dependencies and deployment bloat.
2. **Microservice for billing** — Rejected: adds network calls and latency to every wallet operation. The in-process `WalletGateway` with direct DB access is faster and transactionally safe.
3. **Shared types only (no shared logic)** — Rejected: the billing reserve/settle/release logic is complex and must be identical between API (reserve on creation) and Worker (settle/release on completion). Duplicating it would introduce drift.

## Consequences

**Positive:**
- Domain logic is unit-testable without NestJS bootstrap.
- Worker Docker image is smaller (no NestJS dependencies).
- API and Worker share the same billing, provider, and payment logic — no drift.
- Clear separation: NestJS lives in `apps/api/src/`, pure logic in `packages/*`.

**Negative:**
- Package boundaries are not enforced by the compiler — a developer could accidentally import `@nestjs/common` into a domain package.
- Build order matters: `packages/*` must be built before `apps/*` can typecheck.
- The `.js` import suffix can confuse new contributors.

## Risks

- Boundary violations (NestJS leaking into packages) — mitigated by convention and code review, but not enforced by tooling.
- Build order failures in CI — mitigated by the "Build packages" step in `ci.yml`.

## Follow-ups

- `AGENTS.md`: "领域逻辑优先放在 packages/*, 保持可被 API 和 worker 复用, 不把数据库或 NestJS 依赖无必要地泄漏进纯领域包."
- `CLAUDE.md`: "共享领域能力放在对应 packages/*, 不要复制到 API/worker."

## References

- [packages/billing/src/wallet.ts](../../packages/billing/src/wallet.ts) — `WalletGateway` (no NestJS)
- [packages/provider/src/credential-manager/redis-credential-manager.ts](../../packages/provider/src/credential-manager/redis-credential-manager.ts) — `RedisCredentialManager` (no NestJS)
- [apps/worker/src/generation/pipeline.ts](../../apps/worker/src/generation/pipeline.ts) — Worker pipeline (no NestJS)
- [apps/api/src/generations/generations.service.ts](../../apps/api/src/generations/generations.service.ts) — API service (NestJS, wraps domain packages)
- [packages/contracts/](../../packages/contracts/) — Shared types
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — "Build packages" step before typecheck
