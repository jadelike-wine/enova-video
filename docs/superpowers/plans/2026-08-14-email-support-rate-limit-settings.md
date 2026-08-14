# Email, Support, and Rate-Limit System Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move SMTP/email presentation, support contact, application name, and rate-limit controls into the existing administrator System Settings flow, remove unused environment variables, and stop injecting already-dynamic settings through production Compose.

**Architecture:** Extend the existing Drizzle-backed `settings` registry and `SettingsService`; keep database/Redis/root secrets, deployment controls, ports, and CORS/Swagger bootstrap boundaries in environment variables. Replace the static email sender provider with a runtime delegating sender that rebuilds its SMTP implementation after settings invalidation, and make rate limiting read settings on each request with a short cache-free lookup consistent with API dynamic settings.

**Tech Stack:** TypeScript, NestJS/Fastify, Drizzle/PostgreSQL, Redis Pub/Sub, Nodemailer, Next.js, Docker Compose, Vitest.

---

### Task 1: Add email, support, branding, and rate-limit setting definitions

**Files:**
- Modify: `packages/db/src/settings-registry.ts`
- Modify: `packages/db/drizzle/0011_runtime_system_settings.sql`
- Test: `packages/db/src/settings-registry.spec.ts`

- [x] Add settings keys with env fallback and defaults:

```text
email.smtpHost / SMTP_HOST
email.smtpPort / SMTP_PORT = 587
email.smtpSecure / SMTP_SECURE = false
email.smtpUser / SMTP_USER
email.smtpPassword / SMTP_PASSWORD (secret)
email.smtpFromName / SMTP_FROM_NAME = EnovaMotion
email.smtpFromEmail / SMTP_FROM_EMAIL
email.passwordResetUrl / APP_PASSWORD_RESET_URL
email.emailVerifyUrl / APP_EMAIL_VERIFY_URL
general.appName / APP_NAME = EnovaMotion
general.supportEmail / SUPPORT_EMAIL
security.rateLimitEnabled / RATE_LIMIT_ENABLED = true
security.rateLimitPrefix / RATE_LIMIT_PREFIX = enova:rl
```

- [x] Keep email secrets encrypted, group email settings atomically, and give rate-limit changes a security permission.
- [x] Add default-value backfill cases to the existing migration without deleting existing settings rows.
- [x] Add tests asserting registration, defaults, secret flags, and permissions; run the focused DB test after the red phase.

### Task 2: Make email delivery dynamically reconfigurable

**Files:**
- Modify: `apps/api/src/common/services/email-sender.interface.ts`
- Modify: `apps/api/src/common/services/smtp-email.sender.ts`
- Add: `apps/api/src/common/services/runtime-email.sender.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/admin/email.admin.controller.ts`
- Modify: `apps/api/src/settings/settings.service.ts`
- Test: `apps/api/src/common/services/runtime-email.sender.spec.ts`
- Test: `apps/api/src/settings/settings.service.spec.ts`

- [x] Add a `RuntimeEmailSender` implementing `EmailSender`, delegating to Console/Disabled/SMTP senders and exposing `isSmtpConfigured()` without exposing secrets.
- [x] Build SMTP options from `SettingsService` values, so SMTP host, credentials, sender identity, application name, and reset/verify URLs are read from DB > env > defaults.
- [x] Keep existing dev/test console behavior and production fail-closed behavior when SMTP is incomplete; the runtime adapter reads the current settings snapshot on each operation.
- [x] Change the email admin controller to inject the runtime sender, so “test email” validates the current dynamic configuration instead of a startup-only sender.
- [x] Add and pass tests for runtime delegation, SMTP reconfiguration, incomplete SMTP fallback, and the existing settings fallback path.

### Task 3: Make support and application name available at runtime

**Files:**
- Modify: `packages/db/src/settings-registry.ts`
- Modify: `apps/api/src/settings/public-login-agreement.controller.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/application/WalletView.tsx`
- Test: relevant API settings/public-config tests

- [x] Extend public site config to return `siteUrl`, `supportEmail`, and `appName` from System Settings.
- [x] Replace `process.env.NEXT_PUBLIC_SUPPORT_EMAIL` in `WalletView` with a runtime API read and safe fallback.
- [x] Preserve the existing site URL behavior and production HTTPS validation.
- [x] Update the public controller contract and tests.

### Task 4: Make rate limiting dynamically configurable

**Files:**
- Modify: `apps/api/src/common/guards/rate-limit.guard.ts`
- Modify: `apps/api/src/common/guards/rate-limit.module.ts`
- Modify: `apps/api/src/settings/settings.service.ts`
- Test: `apps/api/src/common/guards/rate-limit.spec.ts`

- [x] Inject `SettingsService` into `RateLimitGuard` and read `security.rateLimitEnabled` and `security.rateLimitPrefix` for each request; retain env fallback through the settings store.
- [x] Keep production Redis failure fail-closed, and keep the prefix change scoped to new rate-limit keys.
- [x] Protect the two rate-limit settings with the existing `settings.security_write` per-setting RBAC path.
- [x] Add and pass tests for DB override, disabled mode, and dynamic prefix.

### Task 5: Remove stale variables and dynamic Compose injection

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.prod.yml`
- Modify: `packages/config/src/schema.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/admin/email.admin.controller.ts`
- Modify: `apps/api/src/common/guards/rate-limit.guard.ts`
- Test: `packages/config/src/schema.spec.ts`

- [x] Remove confirmed-unused `AGNES_API_KEY`, `AGNES_BASE_URL`, `SESSION_SECRET`, and `UPDATE_CHANNEL` from templates and Compose; do not migrate them to System Settings.
- [x] Remove Compose environment injection for payment, task/video, provider, storage-policy, SSRF, logging, SMTP, support, and rate-limit settings already represented in the DB registry, while preserving env fallback in `loadEnv` for old deployments.
- [x] Remove the redundant dynamic app/site URL injection from API Compose; retain only the web build fallback and CORS/Swagger bootstrap values.
- [ ] Keep `DATABASE_URL`, `REDIS_URL`, `BULLMQ_PREFIX`, `CREDENTIAL_MASTER_KEY`, port/host, CORS/Swagger bootstrap values, and deployment/update variables in Compose.
- [ ] Update comments/docs so `.env` contains bootstrap/infrastructure/root-secret/deployment values only.

### Task 6: Verify and regenerate

**Files:**
- Modify if generated: `apps/api/openapi.json`, `packages/sdk/src/generated.ts`

- [x] Run `pnpm db:generate` and `pnpm db:migrate` against the local development database.
- [x] Start the API against local PostgreSQL/Redis and regenerate OpenAPI; run `pnpm sdk:generate`.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- [x] Confirm the removed variables are absent from `.env.example` and production Compose; compatibility code remains in the schema/registry for old deployments.
