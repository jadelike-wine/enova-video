# Production Upgrade Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API startup compatible with Fastify's parser lifecycle and make Docker Compose upgrades fail fast with diagnostic evidence and automatic code-only rollback.

**Architecture:** Keep the existing versioned Compose deployment model. Register the payment form parser only after Nest/Fastify initialization, resolve `APP_VERSION` from the deployment state before every Compose invocation, and make the switch phase use a bounded/non-blocking start followed by explicit health checks and rollback.

**Tech Stack:** Bash, Docker Compose, NestJS, Fastify, TypeScript, Vitest.

---

### Task 1: Prevent the API parser lifecycle regression

**Files:**
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/src/__tests__/main-startup.spec.ts`

- [ ] Add a regression test that starts the Fastify/Nest bootstrap path and asserts `application/x-www-form-urlencoded` can be registered without `FST_ERR_CTP_ALREADY_PRESENT`.
- [ ] Run the focused test and confirm it fails against the current pre-init registration.
- [ ] Initialize Nest/Fastify first, replace the framework parser after initialization, then start listening.
- [ ] Run the focused test and API package checks.

### Task 2: Make Compose version resolution deterministic

**Files:**
- Modify: `scripts/lib.sh`
- Modify: `scripts/update.sh`
- Modify: `scripts/rollback.sh`
- Test: `scripts/update.bats` or an equivalent shell regression test if the repository test setup supports it.

- [ ] Add a single helper that exports the version from `.deploy/version.env` or an explicit target before any Compose command.
- [ ] Ensure `docker compose config` resolves API, Worker, and Web images to concrete immutable tags and emits no blank `APP_VERSION` warning.
- [ ] Prevent command-substitution capture of log lines from corrupting the database backup path.
- [ ] Add explicit resolved-image and sanitized container-state diagnostics.

### Task 3: Bound the switch phase and rollback safely

**Files:**
- Modify: `scripts/lib.sh`
- Modify: `scripts/update.sh`
- Test: `scripts/update.bats` or the repository's shell test equivalent.

- [ ] Start the candidate service set without allowing `depends_on: service_healthy` to block the upgrade script indefinitely.
- [ ] Poll container state/health and HTTP endpoints explicitly.
- [ ] Emit typed failure states and the last 200 lines of relevant container logs.
- [ ] On switch, health, or version failure, perform code-only rollback by default; reserve database restore for an explicit destructive path.
- [ ] Verify rollback updates deployment state and preserves database volumes.

### Task 4: Build and production verification

**Files:**
- No generated or migration files unless verification requires them.

- [ ] Run focused API and deployment tests, lint, typecheck, test, and build as applicable.
- [ ] Build/publish the corrected release images through the existing release workflow boundary.
- [ ] Validate Compose config, container health, API health, Web endpoint, and version endpoint on production.
- [ ] Exercise a failed-switch/rollback path without deleting volumes.
