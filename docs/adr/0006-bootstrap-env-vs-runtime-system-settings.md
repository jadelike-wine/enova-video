# ADR-0006: Bootstrap Env vs. Runtime System Settings Boundary

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

As the system grew, many configuration values were initially managed through environment variables (`.env` / `docker-compose.prod.yml`). This created problems:

1. Changing a value like `WELCOME_CREDITS`, `LOG_LEVEL`, or `STORAGE_PROVIDER` required a rebuild or container restart.
2. The production Docker Compose file was becoming a dumping ground for business parameters, making it hard to distinguish infrastructure from runtime configuration.
3. Admins had no way to adjust settings (SMTP, rate limits, storage credentials) without SSH access and a redeploy.

However, some values **must** remain in environment variables because they are needed before the database is available or are too sensitive for the database.

## Decision

Establish a **clear boundary** between bootstrap environment and runtime system settings:

### Bootstrap env (`.env` / `docker-compose.prod.yml`)

These stay in environment variables because they are needed **before** the database is available or are root-level secrets:

| Category | Examples |
|----------|----------|
| Infrastructure | `DATABASE_URL`, `REDIS_URL`, `PORT`, `HOST`, `NODE_ENV` |
| Root secrets | `CREDENTIAL_MASTER_KEY` |
| Build-time | `APP_VERSION`, `NEXT_PUBLIC_SITE_URL` (build fallback) |
| Security bootstrap | `CORS_ALLOWED_ORIGINS`, `SWAGGER_ENABLED` |
| Deployment | `UPDATE_ENABLED`, `UPDATE_GITHUB_REPOSITORY`, etc. |

### Runtime System Settings (database `settings` table + admin UI)

These are managed in the database via `SettingsService` and the admin console, with DB > env > default precedence:

| Category | Examples |
|----------|----------|
| Object storage | `STORAGE_PROVIDER`, `AWS_REGION`, `AWS_S3_*`, `QINIU_*` |
| Billing | `WELCOME_CREDITS` |
| Auth | Turnstile keys, login agreement settings |
| Task/video | `VIDEO_POLL_INTERVAL_MS`, `VIDEO_MAX_POLLS`, `VIDEO_MAX_WAIT_MS` |
| Security/SSRF | `SSRF_ALLOW_HTTP`, `SSRF_DEV_ALLOW_LIST` |
| Logging | `LOG_LEVEL`, `LOG_FORMAT`, `LOG_PROMPTS`, `ACCESS_LOG` |
| Email/SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_*` |
| Rate limiting | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PREFIX` |
| Queue | `queue.jobAttempts`, `queue.jobBackoffMs` |

### Legacy fallback

Old `.env` values for migrated settings are still parsed as fallback (for backward compatibility with existing deployments). On first startup, if legacy env values exist, they are migrated to the database idempotently (not overwriting existing DB values).

### Live propagation

API settings changes propagate via Redis Pub/Sub invalidation. Worker resources (storage, logger, pipeline config) rebuild on invalidation. `queue.workerConcurrency` remains `restartRequired` because BullMQ Worker concurrency is fixed at construction time.

## Alternatives Considered

1. **Everything in `.env`** — Rejected: requires redeploy for any business setting change; admins can't self-serve.
2. **Everything in the database** — Rejected: `DATABASE_URL`, `CREDENTIAL_MASTER_KEY`, and `PORT` are needed before the database connection is established.
3. **Config service (Consul / etcd)** — Rejected: too heavy for a single EC2 instance. Redis Pub/Sub + PostgreSQL settings table provides the same capability with existing infrastructure.

## Consequences

**Positive:**
- Admins can change storage, SMTP, rate limits, logging, and video polling at runtime without redeploy.
- `.env` is now small and focused on bootstrap/infrastructure.
- Production Compose is cleaner — only infrastructure and root secrets are injected.
- DB > env > default precedence means old deployments continue to work.

**Negative:**
- Two sources of truth for some settings (DB and env fallback) — the precedence must be consistently applied.
- Some settings (e.g., `queue.workerConcurrency`) still require a Worker restart.
- Migration of legacy env values to DB is one-time and must be idempotent.

## Risks

- Settings table corruption could break runtime behavior — mitigated by env fallback and registry defaults.
- Redis Pub/Sub failure could delay propagation — mitigated by cache TTLs and the fact that settings are re-read on each job (for pipeline config).

## Follow-ups

- `AGENTS.md` documents: ".env = 系统如何启动; System Settings = 系统启动之后如何运行."
- `.env.example` comments explicitly list which settings have been migrated to System Settings.
- Implementation plans: [docs/superpowers/plans/2026-08-14-runtime-system-settings-storage-logging.md](../superpowers/plans/2026-08-14-runtime-system-settings-storage-logging.md) and [docs/superpowers/plans/2026-08-14-email-support-rate-limit-settings.md](../superpowers/plans/2026-08-14-email-support-rate-limit-settings.md).

## References

- [packages/db/src/settings-registry.ts](../../packages/db/src/settings-registry.ts) — Setting definitions
- [packages/db/src/settings-store.ts](../../packages/db/src/settings-store.ts) — Settings store with env fallback
- [apps/api/src/settings/settings.service.ts](../../apps/api/src/settings/settings.service.ts) — SettingsService
- [apps/worker/src/worker-settings.ts](../../apps/worker/src/worker-settings.ts) — Worker-side settings reader
- [.env.example](../../.env.example) — Architecture principle comments
- Commit `0fed8a6` — "refactor(db,provider,config): migrate runtime settings to System Settings"
- Commit `9c430dc` — "feat(api,worker): wire runtime settings across API and worker"
