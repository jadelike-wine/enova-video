# Architecture Decision Records (ADR)

This directory records significant architectural decisions in the EnovaMotion (灵动创影) codebase. Each ADR documents **what** was decided, **why**, what alternatives were considered, and what consequences and risks follow.

## When to write an ADR

- A decision affects multiple packages, processes, or long-term maintainability.
- A decision introduces or changes a fundamental pattern (e.g., billing model, queue reliability, credential security).
- A decision constrains future changes in a way that a new contributor or AI agent should know before modifying the code.

**You do not need an ADR for:**
- Bug fixes (use commit messages and CHANGELOG).
- UI tweaks (use product-reference.md).
- Routine dependency upgrades (use CHANGELOG).

## How to use

1. Copy `0000-template.md` to the next available number (e.g., `0007-<short-slug>.md`).
2. Fill in all sections. If you cannot provide evidence for a section, write "Unknown — not documented at decision time" rather than guessing.
3. Set Status to `Proposed`.
4. After review and implementation, set Status to `Accepted`.
5. If a later ADR supersedes this one, update Status to `Superseded by ADR-00XX`.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-modular-monolith-monorepo.md) | Modular Monolith Monorepo: apps/ + packages/ | Accepted |
| [0002](./0002-postgresql-drizzle-versioned-migrations.md) | PostgreSQL 16 + Drizzle ORM with Versioned Migrations | Accepted |
| [0003](./0003-bullmq-redis-queue-and-transactional-outbox.md) | BullMQ + Redis Queue with Transactional Outbox | Accepted |
| [0004](./0004-credits-reserve-settle-release-wallet.md) | Credits Wallet: Reserve / Settle / Release with Per-Job Reservations | Accepted |
| [0005](./0005-provider-credential-encryption-and-redis-lease.md) | Provider Credential Encryption (AES-GCM) and Redis-Based Concurrency Lease | Accepted |
| [0006](./0006-bootstrap-env-vs-runtime-system-settings.md) | Bootstrap Env vs. Runtime System Settings Boundary | Accepted |
| [0007](./0007-object-storage-abstraction-and-ssrf-guard.md) | Object Storage Abstraction with SSRF Guard and Degraded Mode | Accepted |
| [0008](./0008-versioned-release-with-health-check-rollback.md) | Versioned Release (SemVer) with Health-Check-Gated Rollback | Accepted |
| [0009](./0009-domain-logic-in-packages-nestjs-agnostic.md) | Domain Logic in packages/* (NestJS-Agnostic) | Accepted |

## Candidate ADRs (not yet written — lack sufficient evidence)

These decisions are observed in the codebase but the **rationale behind the choice** could not be conclusively recovered from code, commits, or existing documentation. They are listed here so that future contributors can either provide evidence and write the ADR, or make a deliberate decision to document them:

- **Login agreement gate design** (`apps/api/src/settings/public-login-agreement.controller.ts`): The system supports admin-managed legal documents with revision tracking. The design rationale for why terms are DB-managed with revision enforcement (rather than static config) is observable but the decision context is not documented.
- **Setup wizard replacing INITIAL_ADMIN_EMAIL** (commit `02eb5bf`): The first-run setup wizard replaced an env-based initial admin email. The security and UX reasons are inferable but not explicitly documented.
- **Ant Design (antd) adoption for admin UI** (commit `a65ab22`): The admin panel migrated to antd Table/Modal/Image. The decision criteria for choosing antd over other component libraries is not documented.
- **next-intl i18n with locale-based routing** (commit `3cf3c7b`): The app adopted next-intl for internationalization. The rationale for choosing next-intl over alternatives is not documented.

## Conventions

- ADRs are numbered sequentially starting from `0001`.
- Filenames use the pattern `NNNN-kebab-case-slug.md`.
- ADRs are immutable once `Accepted` — if a decision changes, write a new ADR that supersedes it.
- All ADRs must link to code evidence (file paths, commit SHAs, or existing docs).
