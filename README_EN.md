<h4 align="right"><strong>English</strong> | <a href="README.md">简体中文</a></h4>
<p align="center">
  <img src="docs/images/logo.jpg" width="138" alt="EnovaMotion" style="border-radius: 28px;"/>
</p>
<h1 align="center">EnovaMotion</h1>
<p align="center"><strong>An AI-powered multimodal creation platform built on Agnes AI models</strong></p>
<p align="center">Text-to-image / image edit · Text-to-video / image-to-video</p>
<div align="center">
  <a href="https://platform.agnes-ai.com/" target="_blank">
  <img alt="agnes ai" src="https://img.shields.io/badge/platform-Agnes%20AI-ff6b3d?style=flat-square"></a>
  <a href="https://agnes-ai.com/doc/overview" target="_blank">
  <img alt="models" src="https://img.shields.io/badge/models-text%20%7C%20image%20%7C%20video-black?style=flat-square"></a>
  <a href="https://nodejs.org/" target="_blank">
  <img alt="node" src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white"></a>
  <a href="https://nestjs.com/" target="_blank">
  <img alt="nestjs" src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white"></a>
  <a href="https://nextjs.org/" target="_blank">
  <img alt="next" src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white"></a>
  <a href="https://www.postgresql.org/" target="_blank">
  <img alt="postgres" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white"></a>
</div>

<p align="center">
  <img src="docs/images/ai-img-gen.png" alt="EnovaMotion — AI creation platform" width="920" style="border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.18);"/>
</p>

<p align="center">
  <strong>Images · Video — all in one beautiful UI</strong><br/>
  Agnes AI models &nbsp;·&nbsp; Next.js + NestJS + PostgreSQL &nbsp;·&nbsp; Credits billing &nbsp;·&nbsp; Admin console
</p>

## Screenshots

<table cellpadding="6">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/images/ai-img-gen.png" alt="Image generation" width="100%" style="display:block;margin-bottom:6px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
      <strong>🎨 Image generation</strong><br/>
      <span style="font-size:13px">Text-to-image · Edit · Multi-image compose · History replay</span>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/images/ai-video-gen.png" alt="Video generation" width="100%" style="display:block;margin-bottom:6px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
      <strong>🎬 Video generation</strong><br/>
      <span style="font-size:13px">Text/image-to-video · Keyframe animation · Player · Media storage</span>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/images/settings.png" alt="Account & wallet" width="100%" style="display:block;margin-bottom:6px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);"/>
      <strong>⚙️ Account & wallet</strong><br/>
      <span style="font-size:13px">Sign up / log in · Credits balance · Wallet top-up · Account settings</span>
    </td>
  </tr>
</table>

## Features

| Module | Capabilities |
|--------|--------------|
| **Auth & accounts** | Register / login / logout, HttpOnly Cookie sessions, Turnstile bot check, roles (USER/ADMIN) |
| **Image generation** | Text-to-image, single-image edit, multi-image composition; multiple models |
| **Video generation** | Text-to-video, image-to-video, multi-image video; BullMQ async tasks + delayed polling |
| **Unified task system** | `GenerationJob` models image / video tasks with a state machine PENDING→QUEUED→RUNNING→SUCCEEDED/FAILED/CANCELED |
| **Billing** | Credits wallet with Reserve / Settle / Release flow, ledger, idempotent settlement, oversell protection |
| **Payments** | sandbox / Alipay / WeChat adapters: order → callback verify → idempotent credit |
| **Media storage** | Results auto-uploaded to Qiniu Cloud / S3 with persistent history, SSRF protection |
| **Admin console** | `/api/v1/admin/*`: Providers / Credentials / Users / Stats / Settings / Audit / System updates |
| **Workspaces** | Workspace + member isolation (IDOR protection); auto Personal Workspace + Welcome Credits on signup |

### Supported models

| Type | Models |
|------|--------|
| Text | `agnes-2.0-flash`, `agnes-1.5-flash` (deprecated) |
| Image | `agnes-image-2.0-flash`, `agnes-image-2.1-flash` |
| Video | `agnes-video-v2.0` |

## Tech stack

- **Frontend**: Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS (`apps/web`)
- **API**: NestJS 11 + Fastify + TypeScript (`apps/api`)
- **Worker**: BullMQ generation consumer (`apps/worker`)
- **Database**: PostgreSQL 16 · Drizzle ORM (versioned migrations)
- **Queue / cache**: Redis + BullMQ
- **Object storage**: Qiniu Cloud / AWS S3 (optional, abstracted behind an `ObjectStorage` interface)
- **AI API**: [Agnes AI OpenAI-compatible API](https://agnes-ai.com/doc/overview), accessed via `ProviderRegistry` + AES-GCM encrypted credentials

## Architecture

This is a **Modular Monolith**. The same codebase is split into three independent processes under `apps/`, sharing business logic through `packages/*`:

```text
Browser
  ↓
Web (Next.js :3000, apps/web)          # SSR + static pages, /api/v1/* rewrite to API
  ↓ /api/v1/*（server-side rewrite）
API (NestJS :3001, apps/api)           # auth / generations / billing / payments / admin
  ├── PostgreSQL (Drizzle)             # persistence
  ├── Redis / BullMQ                   # queue (enqueue generation jobs)
  ↓
Worker (apps/worker)                   # consumes BullMQ: call Agnes → poll → transfer → settle
  ├── ProviderRegistry + Credential    # AI provider abstraction + AES-GCM encrypted credentials
  ├── ObjectStorage                    # Qiniu Cloud / S3
  └── WalletGateway                    # settle on success / release reserved credits on failure
```

### Repository layout

```
enova-video/
├── apps/
│   ├── api/                  # NestJS API (REST /api/v1 + OpenAPI)
│   ├── worker/               # BullMQ generation consumer
│   └── web/                  # Next.js 15 frontend (App Router)
├── packages/
│   ├── contracts/            # shared types / enums / error codes / queue contracts
│   ├── config/               # env validation (Zod)
│   ├── db/                   # Drizzle schema + migrations + client
│   ├── provider/             # AIProvider abstraction + ObjectStorage + CredentialManager + SSRF
│   ├── billing/              # wallet / credits domain logic (Reserve / Settle / Release)
│   ├── payment/              # payment abstraction + sandbox / Alipay / WeChat adapters
│   ├── sdk/                  # generated TS client from openapi.json
│   └── migrator/             # legacy SQLite → PostgreSQL migration CLI
├── scripts/                  # production update / rollback scripts
├── .github/workflows/        # ci / deploy / release
├── docker-compose.dev.yml    # local PostgreSQL + Redis
├── docker-compose.prod.yml   # production postgres + redis + api + worker + web
└── docs/                     # ops documentation (OPS.md)
```

## Requirements

- Node.js `>=20`
- pnpm `10.27.0`
- Docker (optional, for local PostgreSQL / Redis or production deployment)
- [Agnes AI API Key](https://platform.agnes-ai.com/) (configured in the admin console or seeded into the database)

## Quick start (local development)

### 1. Clone the repository

```bash
git clone https://github.com/jadelike-wine/enova-video.git
cd enova-video
```

### 2. Install dependencies and start infrastructure

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # start PostgreSQL + Redis
cp .env.example .env                              # configure as needed
```

### 3. Start the dev processes

```bash
pnpm dev        # run all new-architecture workspaces (api / worker / web)
```

Or individually:

```bash
pnpm dev:api     # API, default http://localhost:3001
pnpm dev:worker  # generation worker
pnpm --filter @enova/web dev   # frontend, default http://localhost:3000
```

### 4. Database & SDK

```bash
pnpm db:generate   # generate a Drizzle migration
pnpm db:migrate    # run PostgreSQL migrations
pnpm sdk:generate  # regenerate SDK types from apps/api/openapi.json
```

### 5. First-time use

Open [http://localhost:3000](http://localhost:3000) → register an account (auto-creates a Personal Workspace + Welcome Credits). Configure the Agnes AI provider and credentials in the admin console (see below).

## Pre-commit verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm --filter <package> <script>` to target a single workspace for faster feedback.

## Production deployment

Production uses **GHCR images built by GitHub Actions Release**, orchestrated by `docker-compose.prod.yml` with five services: `postgres + redis + api + worker + web`.

### Topology

```text
Browser
  ↓
Reverse Proxy (Nginx / Caddy / Traefik)
  ↓ 3000
Web (Next.js standalone, ghcr.io/...-web)
  ↓ /api/v1/*（server-side rewrite）
API (NestJS, ghcr.io/...-api :3001)
  ├── PostgreSQL 16 (data volume)
  ├── Redis 7 (queue / cache)
  ↓
Worker (ghcr.io/...-worker)
```

- **API** runs Drizzle migrations automatically before startup (idempotent; exits on failure → health check fails → auto rollback).
- **Web** runs as Next.js `output: 'standalone'` and rewrites `/api/v1/*` to the API.
- **Worker** consumes the BullMQ queue for actual generation, polling, transfer, and settlement.

### Deploy

```bash
git tag v1.2.0 && git push origin v1.2.0   # triggers release.yml → builds & pushes GHCR images
./scripts/update.sh v1.2.0                  # on the server: pull and upgrade to the given version
```

Production environment variables are injected via `.env` (see `.env.example`). Key ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SITE_URL` | **optional** | Public domain; build-time fallback. Runtime reads from admin System Settings |
| `DATABASE_URL` | **yes** | PostgreSQL connection string |
| `REDIS_URL` | **yes** | Redis connection string |
| `CREDENTIAL_MASTER_KEY` | **yes** | 32-byte Master Key for AES-GCM encrypting provider secrets (`openssl rand -hex 32`) |
| `STORAGE_PROVIDER` | no (legacy fallback) | `aws_s3` / `qiniu` / `none`, default `aws_s3`; configure in Admin Settings |
| `WELCOME_CREDITS` | no (legacy fallback) | Welcome credits on signup, default `100`; configure in Admin Settings |
| `PAYMENT_MODE` | no | `sandbox` / `alipay` / `wechat`, default `sandbox` |

> **Security**: never use the dev placeholder keys from `.env.example` in production; `CREDENTIAL_MASTER_KEY`, database, and Redis credentials must be injected via server-side env or IAM / Role. Object-storage credentials may be encrypted in Admin Settings, with server-side env or IAM / Role used as fallback.

## Object storage

EnovaMotion supports **AWS S3**, Qiniu, and no object storage. Provider, bucket, credentials, and logging can be changed immediately in Admin Settings → Storage Configuration. When the database has no value, the service falls back to environment variables; an incomplete storage configuration keeps the service running with no object persistence. Business code depends only on the `ObjectStorage` interface in `packages/provider`.

### With Access Keys

```bash
STORAGE_PROVIDER=aws_s3
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=my-bucket
AWS_ACCESS_KEY_ID=yourAccessKey
AWS_SECRET_ACCESS_KEY=yourSecretKey
```

### With an IAM Role (recommended for production)

No keys in config; the service obtains credentials from EC2 Instance Profile / ECS Task Role / EKS IAM Role:

```bash
STORAGE_PROVIDER=aws_s3
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=my-bucket
AWS_S3_PREFIX=agnes-ai
```

### Minimal IAM policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/agnes-ai/*"
    }
  ]
}
```

### Private buckets (presigned URLs)

The database stores only stable object keys (`storage_provider` + `object_key`), never expiring presigned URLs; the API generates 1-hour presigned GET URLs on read.

### Object key convention

```text
{prefix}/images/{yyyy}/{mm}/{dd}/{uuid}.{ext}
{prefix}/videos/{yyyy}/{mm}/{dd}/{uuid}.{ext}
```

### Fault tolerance

Object storage is an optional enhancement: if transfer fails, the system falls back to the Agnes original URL and logs it, without marking the AI result as failed.

## Releases, updates & rollback

> Goal: **versioned releases (SemVer) + manual updates + PostgreSQL backup + real health checks + automatic rollback on failure + manual rollback**.
> **No unattended auto-upgrades** by default; any production upgrade requires a database backup; any new version must pass real health checks.

### Versioning & images

- The root `VERSION` records the current SemVer (e.g. `1.2.0`); Git tags use a `v` prefix (`v1.2.0`), image tags do not.
- Docker images use explicit version tags; never rely on `latest` for upgrades/rollbacks:

```text
ghcr.io/jadelike-wine/enova-video-api:1.2.0
ghcr.io/jadelike-wine/enova-video-worker:1.2.0
ghcr.io/jadelike-wine/enova-video-web:1.2.0
ghcr.io/jadelike-wine/enova-video-deploy-tool:1.2.0
```

`latest` and `sha-<commit>` tags are provided for quick pulls; production upgrades/rollbacks always use explicit versions or digests.

### Publish a version

```bash
git tag v1.2.0
git push origin v1.2.0
```

Pushing a `v*` tag triggers `release.yml`: tests → GHCR login → build & push api / worker / web / deploy-tool (`linux/amd64`) → generate `release.json` → create a GitHub Release.

### Upgrade

```bash
./scripts/update.sh           # upgrade to latest stable
./scripts/update.sh v1.2.0   # upgrade to a specific version
./scripts/update.sh --dry-run # preview only, changes nothing
```

### Rollback

```bash
./scripts/rollback.sh --code-only    # rollback api/worker/web only, keep database
./scripts/rollback.sh --restore-db   # restore code + pre-update PostgreSQL backup (deletes new data)
```

> **Data-loss risk**: `--restore-db` restores the pre-upgrade snapshot; prefer `--code-only` if new data has accumulated.

For manual deploy/rollback from GitHub Actions, use the `Deploy / Rollback (Production)` workflow (SSH into the server and run the scripts). Configure `DEPLOY_HOST` / `DEPLOY_PORT` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_PATH` in the `production` Environment Secrets.

## Logging & troubleshooting

Logs from api / worker / web go to **stdout / stderr** (no in-container `.log` files), so use `docker compose logs` (or `docker logs <container>`).

```bash
docker compose logs -f api            # tail API logs
docker compose logs -f worker         # tail Worker logs
docker compose logs worker | grep "abc123"     # trace by Request ID
docker compose logs worker | grep "task_id=xxx" # trace by generation task ID
docker compose logs api | grep "ERROR"          # only errors
```

### Common issues

| Symptom | Look for |
|---------|----------|
| Agnes 401 (invalid/expired key) | `AGNES_UNAUTHORIZED` or `status=401` |
| Agnes 429 (rate limit) | `AGNES_RATE_LIMITED` / `status=429` / `retry_after` |
| Agnes timeout | `AGNES_TIMEOUT` / `type=timeout` / `retry_count` |
| Credential concurrency / cooldown | `CREDENTIAL_*` / `COOLDOWN` error-code prefixes |
| Video polling timeout | `pollCount` cap / `VIDEO_MAX_POLLS` |
| Wallet / settlement errors | `wallet` / `idempotency_key` / `GENERATION_SETTLE/RELEASE` |
| API unhealthy | api not `healthy` in `docker compose ps`; check `health` logs |
| Web cannot proxy API | `upstream` / `ECONNREFUSED` / `502` in web logs |

### Request ID & Task ID tracing

- Every HTTP request carries a `request_id` (generated by the frontend and forwarded via `X-Request-ID`; the API also generates one). It is echoed in the response header and the error body includes `request_id` and `error_code`.
- Generation jobs track `task_id` (`generation_jobs.id`) and `provider_job_id` (upstream job ID); the worker uses them to trace: submit → poll → done/fail → download → transfer → settle.

## API documentation

The API is **NestJS + Fastify**, with a unified `/api/v1` prefix. Run `apps/api` and see the OpenAPI JSON at `apps/api/openapi.json`.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Register (auto Personal Workspace + Welcome Credits) |
| POST | `/api/v1/auth/login` | Login (HttpOnly Cookie session) |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/me` | Current user |
| GET | `/api/v1/auth/turnstile-config` | Turnstile config |

### Generations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/generations` | Submit generation (image / video) |
| GET | `/api/v1/generations` | Task history |
| GET | `/api/v1/generations/:id` | Task detail & result |
| POST | `/api/v1/generations/:id/cancel` | Cancel task |

### Billing & payments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/billing/wallet` | Wallet balance & reserved |
| GET | `/api/v1/billing/ledger` | Wallet ledger |
| POST | `/api/v1/payment/recharge` | Create recharge order |
| POST | `/api/v1/payment/notify/:channel` | Payment callback verify |
| POST | `/api/v1/payment/sandbox/:orderId/confirm` | sandbox confirm |

### Admin (`/api/v1/admin/*`, requires ADMIN role)

| Resource | Description |
|----------|-------------|
| `/admin/providers` | Provider CRUD |
| `/admin/providers/:providerId/credentials` | Provider credentials |
| `/admin/users` | User management (status / grant credits) |
| `/admin/stats` | Business stats |
| `/admin/settings` | Dynamic config |
| `/admin/audit-logs` | Audit logs |
| `/admin/system-update` | System update / rollback |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness |
| GET | `/api/v1/health/ready` | Readiness |

## Database

New architecture uses **PostgreSQL 16 + Drizzle ORM**. Schema is defined in `packages/db/src/schema.ts`, versioned migrations in `packages/db/drizzle/`.

| Domain | Tables | Purpose |
|--------|--------|---------|
| Identity | `users` / `sessions` | Users & HttpOnly Cookie sessions |
| Workspace | `workspaces` / `workspace_members` | Workspace & member isolation |
| Generation | `generation_jobs` / `assets` | Unified generation tasks & assets |
| Provider | `providers` / `provider_credentials` | Providers & **AES-GCM encrypted** credentials |
| Billing | `wallets` / `wallet_ledger` | Balance / reserved / ledger (idempotent) |
| Pricing | `pricing_rules` / `usage_events` | Pricing rules & usage |
| Payment | `orders` / `payment_transactions` | Recharge orders & transactions |
| Admin | `admin_audit_logs` / `settings` | Audit logs & dynamic config |
| Legacy | `legacy_migration` | Legacy SQLite data migration |

### Money convention (avoid float errors)

- `credits`: integer (bigint), unit = 1 credit.
- `*_cost_usd`: integer, unit = micro-USD (1e-6 USD), i.e. 1 USD = 1_000_000.
- All money math must use integer arithmetic.

## Project structure

```
enova-video/
├── apps/
│   ├── api/                     # NestJS API（/api/v1 + OpenAPI）
│   │   └── src/
│   │       ├── auth/            # register / login / session / Turnstile
│   │       ├── generations/     # generation tasks
│   │       ├── billing/         # wallet / pricing
│   │       ├── payment/         # recharge / callback
│   │       ├── admin/           # admin console
│   │       ├── settings/        # dynamic config
│   │       ├── health/          # health checks
│   │       └── app.module.ts    # app assembly
│   ├── worker/
│   │   └── src/
│   │       ├── generation/      # pipeline / repo / state
│   │       └── processors/      # BullMQ consumers
│   └── web/
│       ├── app/                 # marketing + /app + /auth + /docs + /models
│       ├── components/          # marketing/ + application/ + auth/
│       └── lib/                 # api.ts / seo.ts / models.ts / auth.tsx ...
├── packages/
│   ├── contracts/               # types / enums / error codes / queue contracts
│   ├── config/                  # env validation（Zod）
│   ├── db/                      # Drizzle schema + migrations
│   ├── provider/                # AIProvider + ObjectStorage + CredentialManager + SSRF
│   ├── billing/                 # wallet / credits domain logic
│   ├── payment/                 # payment abstraction + sandbox / alipay / wechat
│   ├── sdk/                     # generated TS client
│   └── migrator/                # legacy SQLite migration
├── scripts/                     # update.sh / rollback.sh / lib.sh
├── .github/workflows/           # ci / deploy / release
├── docker-compose.dev.yml       # local PostgreSQL + Redis
├── docker-compose.prod.yml      # production postgres + redis + api + worker + web
└── docs/                        # ops documentation（OPS.md）
```
