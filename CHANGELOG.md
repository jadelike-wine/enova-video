# Changelog

All notable changes to EnovaMotion (灵动创影) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

Git history is the ultimate source of truth; this file aggregates user-, developer-, and ops-relevant changes. Not every commit is listed — only changes that matter to consumers, operators, or maintainers.

## Unreleased

---

## [1.7.4] — 2026-08-16

### Added
- Forgot-password flow and page (`/auth/forgot-password`): sends a password reset email and surfaces success/failure states.
- Registration controls: open-registration toggle, email domain whitelist with per-domain cap, invitation code, and promo code are now enforced at registration and configurable via system settings.
- Public `auth-config` endpoint exposing registration/verification/password-reset toggles to the web app.

### Changed
- Filled-in default login agreement documents (services terms, usage policy, supported regions, service-specific terms) as system-settings defaults.
- Refined admin system settings panels (general, security, agreement) and the system update view; removed the custom-endpoint editor draft.
- Renamed `APP_NAME` env to `SITE_NAME` for site/email branding; dropped the stale `general.appName` migration default.

---

## [1.7.1] — 2026-08-15

### Added
- Password reset and email verification pages (`/auth/reset-password`, `/auth/verify-email`) with forgot-password, reset, and verify API calls; email links derive from the site URL with a locale-aware path (`/zh-CN/...`) when dedicated URLs are not configured.

### Changed
- UI theme refreshed from violet to a teal primary palette (antd tokens, Tailwind primary/accent and shadows), lighter borders, and a rebuilt settings tabs UI with keyboard navigation.

---

## [1.7.0] — 2026-08-15

### Added
- Admin SMTP connection test (no email sent): the host is validated against the same SSRF guard used for provider URLs (private/link-local addresses blocked, optional DNS re-check), the transport enforces timeouts, and the client only receives a fixed success/failure message while details go to server logs.
- Admin AI provider management page: browse providers and their credentials, and create/update/delete providers and credentials from the UI, with step-up password verification for credential mutations.

---

## [1.6.0] — 2026-08-15

### Added
- Admin-configurable site branding and content: site name, subtitle, logo, contact info, and doc URL, exposed via the public `site-config` endpoint and consumed across the web app (header, footer, wallet, settings).
- Custom homepage content rendered through a shared `HomeContentRenderer` supporting inline HTML/Markdown or an external iframe URL, with a compact-home toggle and a hide-CCS-import-button toggle.
- Admin-defined custom menu items embedded into the app sidebar as iframe routes (`/app/custom/[menuId]`), scoped by `user`/`admin` visibility.
- Centralized table pagination driven by site config (`table.defaultPageSize`, `table.pageSizeOptions`) via a shared `useTablePagination` hook used across admin and user tables; admin settings validate URL/logo formats, custom menu JSON, and page-size lists.

### Fixed
- Update/rollback scripts keep the admin one-click update mounts (`/var/run/docker.sock`, `/host/repo`) when recreating the API container with `UPDATE_ENABLED=true`, so subsequent updates from the admin UI no longer fail with "no such file or directory".
- Deploy workflow pulls the `deploy-tool` image for the actually deployed version (`.deploy/version.env`) instead of the repo `VERSION` file; the release workflow now fails early when `VERSION` does not match the release tag.

---

## [1.5.0] — 2026-08-14

### Added
- i18n support via `next-intl` with locale-based routing across application and marketing components.
- Architecture Decision Records (ADR 0000–0009) plus docs for reading order, plans, performance experiments, and product-language frameworks.

### Changed
- Web UI migrated to Ant Design v6: app, auth, media and admin views use antd components with a shared `AntdProvider` (theme + locale) wrapper; admin users view uses antd `Table`/`Modal`, and the image lightbox is replaced by antd `Image` preview.
- AppShell is mounted once as a shared layout for all app routes, so the sidebar and session state persist across navigation instead of remounting per page.

---

## [1.4.0] — 2026-08-14

### Added
- Admin settings UI improvements with setting descriptions and grouped layout.
- Login agreement gate with admin-managed legal documents (revision tracking, user consent logging).
- Runtime system settings: storage, billing, logging, SSRF, task/video, SMTP, rate limits, and queue options migrated to database-managed settings with admin UI.
- Worker dynamic configuration hot-reload via Redis Pub/Sub invalidation.
- Object storage test action in admin UI (upload, verify, delete test object).
- Qiniu (七牛云) object storage provider implementation.
- `BACKUP.md` documentation and daily disaster recovery backup script (`scripts/backup.sh`).
- Product reference document (`docs/product-reference.md`) and docs index (`docs/README.md`).

### Changed
- `.env` scope reduced to bootstrap/infrastructure/root-secret only; business settings moved to System Settings (DB > env > default).
- Production Docker Compose no longer injects migrated business settings.
- Site URL is now an admin-managed runtime setting (build-time `NEXT_PUBLIC_SITE_URL` is fallback only).
- AWS S3 is the default storage provider (previously `none`); legacy `s3` env alias still works.

### Removed
- Text chat / conversation feature (`/app/chat`, `ChatView`, `/api/v1/conversations`). Old `/chat` links 308-redirect to `/app/images`. Database tables (`conversations`, `messages`) retained for historical data only.
- Confirmed-unused environment variables: `AGNES_API_KEY`, `AGNES_BASE_URL`, `SESSION_SECRET`, `UPDATE_CHANNEL` from `.env.example` and production Compose.
- `INITIAL_ADMIN_EMAIL` env-based admin initialization replaced by `/setup` wizard.

### Fixed
- Native `http.ServerResponse` handling in NestJS exception filter and access log middleware.
- Deploy-tool healthcheck using `host.docker.internal`.
- Stale operation status during API restart in admin system-update.
- Session cookie `Secure` flag now respects request protocol (fixes HTTP deployment login).
- Integration tests skip when `DATABASE_URL` is absent (avoids CI failures).
- `ListQueryDto` limit/offset `@Type` conversion (fixes list API validation failures).
- `flock release_lock` shell syntax error in deployment scripts.
- CI production compose validation with required env vars.

---

## [1.3.0] — 2026-08-12

### Added
- P1 commercialization: RBAC roles/permissions, Settings v2 (transactional CAS / grouped updates / env migration), analytics with cost and gross margin, account lifecycle, and coupons.
- Setup wizard for first-run admin creation (replaces `INITIAL_ADMIN_EMAIL` env var).
- Settings v2: transactional CAS, grouped batch updates, env-to-DB migration, Worker dynamic config hot-reload.
- Redis-backed rate limiting guard.
- Email templates, mock sender, and tests (P0-1).
- SMTP email integration, CORS protection, and ops monitoring (P0).
- Worker resource cleanup service and object storage delete/exists operations.
- Email management and ops monitoring features.
- Order management and billing system improvements.

### Changed
- Application visual upgrade to light purple theme.
- Brand-neutralized UI: hidden underlying third-party model names from user-visible surfaces.
- Container timezone set to Shanghai for api/worker/web.
- Settings page shows full user ID.
- Sidebar scroll position persists across route changes.

### Removed
- AI conversation feature and standalone marketing/docs pages (first removal pass).

### Fixed
- `EMAIL_SENDER` provider registration in `AuthModule`.
- Integration test skip behavior for missing `DATABASE_URL`.

---

## [1.2.0] — 2026-08-11

### Added
- P0 commercialization: payment/refund strategy, billing concurrency and merchant management backend, plan purchase, admin operations console, and fulfillment corrections.
- Refund concurrency integration test spec and migration upgrade spec.
- `.gitignore` for `deep-research-reports/` output artifacts.

### Fixed
- CI/Release builds packages before typecheck (resolves `@enova/contracts` module-not-found).
- Dockerfile runtime copies application `node_modules` (fixes missing `reflect-metadata`).
- Production frontend CSS loss (Next.js 15.5 nested layout silently dropping global styles).

---

## [1.1.0] — 2026-08-10

### Added
- Complete SaaS backend rewrite: monorepo (NestJS + Drizzle + BullMQ) replacing old FastAPI + SQLite architecture.
- Frontend migration to new architecture with generation pipeline and database migrations.
- Docker deployment and update scripts (`update.sh`, `rollback.sh`, `lib.sh`).
- `AGENTS.md` and `CLAUDE.md` project documentation.
- GitHub Actions CI, release, and deploy workflows.

### Changed
- Old architecture (`backend/` FastAPI + SQLite and `frontend/`) deleted; all new work in monorepo.

### Fixed
- GitHub Actions deployment chain and release gate.
- pnpm/action-setup version to v6 (Node 20 deprecation warning).
- GitHub Actions to Node 24 runtime (Node 20 deprecation warning).

---

[1.4.0]: https://github.com/jadelike-wine/enova-video/releases/tag/v1.4.0
[1.3.0]: https://github.com/jadelike-wine/enova-video/releases/tag/v1.3.0
[1.2.0]: https://github.com/jadelike-wine/enova-video/releases/tag/v1.2.0
[1.1.0]: https://github.com/jadelike-wine/enova-video/releases/tag/v1.1.0
