# ADR-0008: Versioned Release (SemVer) with Health-Check-Gated Rollback

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The production deployment model must:

1. **Never deploy unattended**: no auto-deploy on push to `main`.
2. **Version every release** with SemVer and immutable Docker image tags.
3. **Back up the database before any upgrade**: if something goes wrong, data must be recoverable.
4. **Health-check before declaring success**: a new version is only "deployed" when the API health endpoint and web root both respond successfully.
5. **Auto-rollback on failure**: if health checks fail after upgrade, the system rolls back to the previous version automatically.
6. **Support manual rollback**: allow both code-only rollback (keep DB) and full rollback (restore pre-upgrade DB snapshot).

## Decision

### Versioning

- Root `VERSION` file records the current SemVer (e.g., `1.4.0`).
- Git tags use `v` prefix (`v1.4.0`); Docker image tags do not (`1.4.0`).
- Images: `ghcr.io/jadelike-wine/enova-video-{api,worker,web,deploy-tool}:<version>`.
- `latest` and `sha-<commit>` tags exist for convenience but are never used for production upgrades/rollbacks.

### Release flow

1. `git tag v1.4.0 && git push origin v1.4.0`
2. GitHub Actions `release.yml`: tests → build & push 4 images (`linux/amd64`) → generate `release.json` → GitHub Release.
3. `release.yml` **only** builds and publishes — it does **not** deploy to the server.

### Upgrade flow (`scripts/update.sh`)

```
lock → determine target version → preflight (Docker/Compose) → current health check
→ PostgreSQL consistency backup → save deployment state → pull new images
→ verify digests → switch APP_VERSION → docker compose up -d --no-build
→ full-chain health check (api /health + web /)
→ success recorded; failure → automatic rollback
```

### Rollback flow (`scripts/rollback.sh`)

- `--code-only`: roll back api/worker/web images to previous version, **do not** touch the database (preserves new data).
- `--restore-db`: restore pre-upgrade PostgreSQL snapshot (deletes new data — requires confirmation).

### CI/CD separation

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR / push to main | Lint + typecheck + test + compose validation |
| `release.yml` | Push `v*` tag | Build & push images + GitHub Release (no deploy) |
| `deploy.yml` | `workflow_dispatch` (manual) | SSH to server, run `update.sh` or `rollback.sh` |

### Deployment state

- `.deploy/state.json`: previous/current versions, digests, backup paths, `update_id`.
- `.deploy/history.json`: deployment history.
- `.deploy/version.env`: only `APP_VERSION`.
- `.deploy/update.lock`: flock-based mutex (update and rollback are mutually exclusive).
- `.deploy/logs/`: per-deployment logs.
- **No secrets** are stored in `.deploy/`.

## Alternatives Considered

1. **Auto-deploy on push to main** — Rejected: production upgrades require database backups and health verification; unattended deployment risks data loss.
2. **Kubernetes with rolling updates** — Rejected: the system runs on a single EC2 instance with Docker Compose. K8s would add operational complexity without proportional benefit.
3. **Blue-green deployment** — Considered but not chosen: the current single-instance Docker Compose model with health-check-gated rollback is simpler and sufficient.
4. **`latest` tag for upgrades** — Rejected: immutable version tags are mandatory. `latest` is for quick pulls only.

## Consequences

**Positive:**
- Every release is traceable to a Git tag and immutable image digest.
- Failed upgrades auto-rollback to the previous working version.
- Database is always backed up before any upgrade.
- No unattended production changes.

**Negative:**
- Upgrade requires manual execution (`update.sh` or `deploy.yml` workflow_dispatch).
- Rollback with `--restore-db` is destructive (deletes new data).
- The deployment state in `.deploy/` is critical — corruption could complicate rollback.

## Risks

- `update.sh` or `rollback.sh` bugs could leave the system in a broken state.
- `--restore-db` data loss if used after significant new data has accumulated.
- GitHub Actions secrets compromise could allow unauthorized production access.
- Docker image pull failures (GHCR auth, network) could block upgrades.

## Follow-ups

- `AGENTS.md`: "涉及线上部署、数据库回滚或删除数据等不可逆操作时, 先与用户确认."
- `docs/OPS.md` documents server access, diagnostics, and the admin UI system-update feature.
- `docs/BACKUP.md` documents the dual backup strategy (daily disaster recovery + per-upgrade rollback).
- The admin console includes a "System Update" page that calls `scripts/update.sh` via the `deploy-tool` container (requires `docker.sock` mount).

## References

- [scripts/update.sh](../../scripts/update.sh) — Upgrade script
- [scripts/rollback.sh](../../scripts/rollback.sh) — Rollback script
- [scripts/lib.sh](../../scripts/lib.sh) — Shared deployment utilities
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — CI
- [.github/workflows/release.yml](../../.github/workflows/release.yml) — Release
- [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) — Manual deploy/rollback
- [docs/OPS.md](../OPS.md) — Operations manual
- [docs/BACKUP.md](../BACKUP.md) — Backup and recovery
- [README.md](../../README.md) §版本发布、更新与回滚 — Release documentation
- Commit `abd925e` — "新架构傻瓜化 Docker 部署与更新"
