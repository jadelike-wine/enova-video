# Changelog

All notable changes to EnovaMotion (灵动创影) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

Git history is the ultimate source of truth; this file aggregates user-, developer-, and ops-relevant changes. Not every commit is listed — only changes that matter to consumers, operators, or maintainers.

## [1.7.20] — 2026-08-17

### Changed
- System update admin page uses compact (`size="small"`) version cards with tighter spacing and reduced title size.

---

## [1.7.19] — 2026-08-16

### Fixed
- Generation job creation now inserts the `generation_jobs` row before reserving credits in the same transaction. Previously reserving first could trigger a foreign-key violation on `credit_reservations.generation_job_id` because the referenced job did not exist yet (confirmed in production).

---

## [1.7.18] — 2026-08-16

### Added
- Generation history moved to dedicated routes (`/app/images/history`, `/app/videos/history`) with a shared `GenerationHistory` component; the app nav now groups images/videos into expandable sections with "Generate" and "History" entries.
- Site logo configured in admin settings is now used as the browser favicon (with cache busting); added a default app icon.

### Changed
- Video pricing normalizes width×height into resolution tiers (e.g. 1280×720 → 720p) using max(width, height) so portrait and landscape both match; unknown resolutions keep their exact dimensions.
- Image pricing can derive a canonical resolution from size+ratio when only a resolution table is configured, and raises a clearer error for unsupported size/ratio combinations.
- Generation views no longer show the inline history sidebar (history is on its own page).
- README drops the deprecated `agnes-1.5-flash` text model.

---

## [1.7.17] — 2026-08-16

### Changed
- Admin settings: step-up (admin password) verification is now required only for security-sensitive settings (`ssrf.*`, `security.rateLimit*`), not for ordinary settings like site logo/name. Ordinary updates still require base `SETTINGS_WRITE` permission plus audit logging; batch and secret-clear operations follow the same rule.
- Admin settings view detects the backend `stepUpRequired` signal and prompts the admin for their password, then retries the request with the step-up header.
- System update "发布信息" card is now collapsible and collapsed by default, matching the publish-notes style.

---

## [1.7.16] — 2026-08-16

### Added
- Dynamic pricing now supports Agnes size/ratio-tiered image pricing (1K/2K/3K/4K) and video width×height resolution pricing, with a canonical resolution mapping from size+ratio for the audit snapshot. Dimension matching falls back through size → resolution → width×height and records the matched dimension.
- Pricing audit breakdown now includes the requested size, canonical resolution, and matched size key.
- Admin pricing editor gains a size/ratio multiplier table (with Agnes Image 2.1 Flash tiered note) alongside the existing resolution/quality/fps tables.
- Redesigned the image and video generation views (workspace/generation-records layout, prompt composer with AI enhance, size/ratio/duration/advanced settings, estimated-credit display, upload/regenerate/variation interactions).

### Changed
- Pricing quote now raises `MISSING_PRICING_DIMENSION` when a size table is configured but no size is provided and it cannot be reverse-derived from resolution; video per-second pricing clarifies that duration is required.

---

## [1.7.15] — 2026-08-16

### Added
- Dynamic pricing engine (`packages/billing`): pure calculation functions for image (base × resolution × quality) and video (base + duration×per-second, × resolution × quality × fps) pricing, with rule extraction/normalization and an audit breakdown.
- Pricing quotes now persist a `calculation_snapshot` (jsonb) recording each step of the dynamic calculation.
- Admin pricing page gains a dynamic pricing editor (base credits, per-second duration price, and resolution/quality/fps multiplier tables) with rules summary.

### Changed
- Quote and preview paths now prefer dynamic pricing rules over fixed credits; publishing accepts optional `dynamicRules` (embedded into `pricingJson.rules`), with credits defaulting to 0 for dynamic mode.
- Removed the step-up password gate from publishing a pricing version.

---

## [1.7.14] — 2026-08-16

### Added
- Admin pricing management page (`/app/admin/pricing`): a model pricing overview showing each system model with its latest published credits/version and status (unconfigured/published), plus a publish-price modal (step-up protected). Adds an authoritative system-model registry and a backend overview endpoint.

---

## [1.7.13] — 2026-08-16

### Changed
- The system update publish-notes box is now fully collapsible: by default only the title row (with an expand toggle) is shown, and the description/content/copy button appear only after expanding.
- Video duration preset buttons in the generation view now keep their highlight in sync when the frame count changes or a saved task is loaded (previously the active preset highlight could be stale).

---

## [1.7.12] — 2026-08-16

### Added
- Admin account management: a flattened account list (credential + provider) with search/filter, account name/remark fields, and a connection-test endpoint that validates an API key with an SSRF-guarded request before or after saving.
- `provider_credentials` gains admin-facing `name` and `remark` columns; `email_templates` table is included in the schema snapshot.

### Changed
- The system update publish-notes box now always collapses by default, showing only the title until expanded (instead of only collapsing when content exceeds a line threshold).

---

## [1.7.11] — 2026-08-16

### Changed
- The language switcher moved to the top of the logged-in app shell sidebar (beside the logo/site title) so it is clearly visible, instead of the bottom of the sidebar next to the logout button.
- Admin credential management (API key create/update/delete and add-Agnes-account) no longer requires a separate step-up password; the authenticated admin session is the gate.
- System update release body and publish notes now auto-collapse long content in the copy box with an expand/collapse toggle.

---

## [1.7.10] — 2026-08-16

### Added
- Admin can add an Agnes account with just an API key; the agnes provider is auto-created if missing, the credential is encrypted, and the action is step-up verified and audited.
- Video generation now reports real poll progress from the provider, shown live in both the task list and detail views (instead of a fixed pulse bar).

### Changed
- Image generation uses native Agnes tiered resolution (1K/2K/3K/4K) plus aspect ratio instead of legacy exact pixel sizes; the UI shows the resulting output dimensions. Historical exact-size tasks are normalized to the new model.
- Video generation supports text-to-video and image-to-video only (multi-image and keyframe modes removed from the UI).
- Video duration and frame validation are shared across API/worker/billing/frontend via `packages/contracts` (seconds = numFrames / frameRate, 8n+1 frame rule, 1–60 frameRate).
- Video polling prefers the Agnes `video_id` endpoint and reads the final result from `metadata.url` (task endpoint and `remixed_from_video_id` remain as fallbacks).
- Language switcher is now available in the logged-in app shell, not only the marketing header.

---

## [1.7.9] — 2026-08-16

### Fixed
- API no longer fails to boot (`FST_ERR_CTP_ALREADY_PRESENT`) because the payment raw-body form parser was registered before Nest/Fastify initialization. The parser now lives in a reusable module and replaces the built-in parser only after `app.init()`, preserving raw form bytes for webhook signature verification.

### Changed
- Production upgrade/rollback is now deterministic and fail-fast: `APP_VERSION` is loaded from the deployment state before every Compose invocation (and required during interpolation), and the resolved api/worker/web image tags are verified before switching.
- The switch phase is bounded: services are brought up without blocking on `depends_on: service_healthy`, then container state/health and the reported API version are polled explicitly. On switch, health, or version failure, the last log lines and container diagnostics are captured and a code-only rollback runs by default (database restore stays an explicit path). Rollback and failed states are recorded in deployment state/history.

---

## [1.7.6] — 2026-08-16

### Fixed
- Admin settings update now accepts large values (base-64 site logos up to ~410K, login agreement documents JSON, custom menu items JSON) by raising the DTO value length cap from 4000 to 10,000,000 chars; per-setting validation remains at the service layer.

---

## [1.7.5] — 2026-08-16

### Changed
- Admin system settings workbench: replaced plain skeleton with a `Spin` loading state and a `Result` error view (with error detail and retry), and guarded async loads against stale responses / unmounted setState.
- Backup settings panel now loads asynchronously with loading/error/success states (Spin, Result, Alert) while keeping the deployment/ops guidance.
- App-level `loading.tsx` shows the shared content loading placeholder while nested personal-center routes stream in.
- Route pending indicator gained a 5s timeout fallback (so it clears even when navigation only changes query string), timer cleanup on unmount, and more precise nav active matching.
- Dev builds compile faster by opting antd, @ant-design/icons, dayjs, and next-intl into Next.js `optimizePackageImports`.

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
