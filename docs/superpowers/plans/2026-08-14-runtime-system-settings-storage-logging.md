# Runtime System Settings for Storage, Billing, and Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move billing, object-storage, and logging controls into the existing administrator system-settings flow, with database-over-env-default precedence, AWS S3 as the default, Qiniu support, live propagation, and a storage connectivity test.

**Architecture:** Extend the existing registered-settings/SettingsStore model rather than adding a configuration framework. A shared provider-side resolver will turn the generic settings reader plus legacy environment aliases into one typed storage configuration used by API test actions and Worker resource rebuilding. Redis invalidation will refresh API logger settings and Worker storage/logger resources immediately.

**Tech Stack:** TypeScript, NestJS/Fastify, Next.js 15, Drizzle/PostgreSQL, Redis Pub/Sub, Pino, AWS SDK v3, native Fetch/FormData for Qiniu.

---

### Task 1: Add canonical setting definitions and compatibility normalization

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/db/src/settings-registry.ts`
- Modify: `packages/db/src/settings-store.ts`
- Add: `packages/db/drizzle/0011_runtime_system_settings.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Test: `packages/config/src/schema.spec.ts`, `packages/db/src/settings-registry.spec.ts`

- [x] Add canonical `aws_s3`, `qiniu`, and `none` storage settings using `AWS_REGION`, `AWS_S3_*`, and `QINIU_*`, plus `log.prompts` and `log.accessLog`; preserve registry defaults (`aws_s3`, `ap-southeast-1`, `agnes-ai`, `z0`, `INFO`, `text`, false, true).
- [x] Normalize old `STORAGE_PROVIDER=s3` and `S3_*` environment names into canonical AWS values only when canonical values are absent, so old deployments still start while business code uses no `S3_*` keys.
- [x] Add a migration that adds the settings metadata needed to identify the new runtime settings while leaving values absent when env fallback must remain effective; keep defaults in the registry and make migration idempotent.
- [x] Prove canonical env parsing, legacy alias parsing, and registry defaults with failing tests first, then implementation and focused tests.

### Task 2: Create shared typed storage resolution and provider implementations

**Files:**
- Add: `packages/provider/src/storage/config.ts`
- Add: `packages/provider/src/storage/qiniu.ts`
- Modify: `packages/provider/src/storage/factory.ts`
- Modify: `packages/provider/src/storage/s3.ts`
- Modify: `packages/provider/src/index.ts`
- Modify: `packages/provider/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `packages/provider/src/__tests__/factory.test.ts`, `packages/provider/src/__tests__/qiniu.test.ts`, `packages/provider/src/__tests__/storage-config.test.ts`

- [x] Define the shared typed resolver with DB reader > env > defaults precedence and an explicit `configured` flag; include AWS session token and all Qiniu fields.
- [x] Implement Qiniu upload, URL, existence, and deletion behavior behind `ObjectStorage`, retaining downloader limits and cleanup semantics.
- [x] Update the factory to accept canonical `aws_s3`, `qiniu`, and `none`, with only a compatibility alias for legacy `s3`; preserve S3-compatible endpoints and session credentials.
- [x] Prove factory selection, resolver fallback, Qiniu token/request shape, and S3 session-token wiring with failing tests first, then implementation and focused tests.

### Task 3: Make API and Worker consumers use dynamic settings and live logging

**Files:**
- Modify: `apps/api/src/settings/settings.service.ts`
- Modify: `apps/api/src/settings/settings.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/common/logger/enova-logger.ts`
- Add: `apps/api/src/common/access-log/access-log.middleware.ts`
- Modify: `apps/api/src/generations/generations.service.ts`
- Modify: `apps/worker/src/worker-settings.ts`
- Modify: `apps/worker/src/worker-resources.ts`
- Modify: `apps/worker/src/worker/logger.ts`
- Modify: `apps/worker/src/main.ts`
- Test: corresponding API/Worker settings, logger, middleware, and resource tests

- [x] Expose `getSystemSetting`/typed storage access through the existing SettingsService and use the shared resolver; do not read business settings directly from `process.env`.
- [x] Apply `log.level`, `log.format`, `log.prompts`, and `log.accessLog` from DB/env/default at startup and on Redis invalidation; use canonical log-level mapping while accepting the requested uppercase values.
- [x] Add request access logging controlled by `log.accessLog` and prompt logging controlled by `log.prompts`, with prompts omitted by default and existing redaction preserved.
- [x] Change Worker storage resource construction to canonical AWS/Qiniu settings, keep the process alive with a no-op storage when the selected provider is incomplete, and log the actionable “请配置对象存储” state.
- [x] Prove live setting updates and env fallback in focused tests before implementation changes.

### Task 4: Add administrator storage test API and dynamic Provider UI

**Files:**
- Modify: `apps/api/src/admin/settings.admin.service.ts`
- Modify: `apps/api/src/admin/settings.admin.controller.ts`
- Modify: `apps/api/src/admin/admin.module.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/application/AdminSettingsView.tsx`
- Test: `apps/api/src/admin/settings.admin.service.spec.ts`, `apps/web/components/application/AdminSettingsView.spec.tsx` (or the repository’s existing frontend test location)

- [x] Add an admin-only storage test action that uploads a generated test object, verifies existence and display/public URL access, then deletes it; return provider, bucket/domain, URL accessibility, and actionable errors without secrets.
- [x] Add storage-specific dynamic rendering: provider selector for AWS S3/Qiniu/none, provider fields only for the selected provider, grouped save, configured warning, and “测试配置” button.
- [x] Prove authorization, cleanup, and provider-specific UI behavior with failing tests first, then implementation and focused tests.

### Task 5: Remove migrated env entries from templates/local env and update documentation

**Files:**
- Modify: `.env` (local ignored deployment file, if present)
- Modify: `.env.example`
- Modify: `docker-compose.prod.yml`
- Modify: `README.md`
- Modify: `README_EN.md`
- Modify: `AGENTS.md`
- Modify: `docs/product-reference.md`

- [x] Remove the migrated billing/storage/logging entries from `.env` and `.env.example`; retain only bootstrap/infrastructure/root-secret settings and document DB > env > default fallback.
- [x] Remove Docker wiring for migrated values and update the storage default/documentation to AWS S3; keep compatibility alias behavior documented for old deployments.
- [x] Update product/reference facts to reflect AWS S3/Qiniu/none and the admin storage test.

### Task 6: Verify, regenerate, and report

**Files:**
- Modify if generated: `apps/api/openapi.json`, `packages/sdk/src/*`

- [x] Run focused package tests after each green task.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; regenerate OpenAPI/SDK if the API contract changed.
- [x] Inspect `git diff` and report changed files, migration SQL, setting fields, resolution flow, test procedures, and which env entries are safe to remove.
