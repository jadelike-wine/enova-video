# ADR-0007: Object Storage Abstraction with SSRF Guard and Degraded Mode

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The Worker downloads AI-generated media (images/videos) from provider URLs and transfers them to persistent object storage. This involves:

1. **Multiple storage backends**: AWS S3, Qiniu (七牛云), and a no-op `none` provider for development.
2. **Security**: Provider-returned media URLs and provider base URLs must be validated to prevent SSRF (Server-Side Request Forgery) attacks — e.g., `http://169.254.169.254/latest/meta-data/`.
3. **Download safety**: remote downloads must have timeout, size limits, and content-type allow-lists.
4. **Fault tolerance**: if object storage is not configured or the transfer fails, the system should not mark the AI generation as failed — it should degrade to keeping the provider's original URL.

## Decision

### ObjectStorage interface

Define an `ObjectStorage` abstraction in `packages/provider/src/storage/` with implementations for:

| Provider | Implementation | Use case |
|----------|---------------|----------|
| `aws_s3` | `S3Storage` | Production (IAM Role or Access Key) |
| `qiniu` | `QiniuStorage` | China-region alternative |
| `none` | No-op storage | Development / unconfigured |

The factory (`storage/factory.ts`) accepts canonical `aws_s3` / `qiniu` / `none` with a legacy alias for `s3`. Configuration is resolved from System Settings > env > defaults via a shared typed resolver (`storage/config.ts`).

### SSRF guard

`packages/provider/src/url-guard.ts` validates all remote URLs:

- **Blocks**: `localhost`, `127.0.0.1`, `[::1]`, private ranges (`10.x`, `172.16-31.x`, `192.168.x`), link-local (`169.254.x`), `0.0.0.0`, `file:` and `ftp:` schemes.
- **Blocks HTTP in production** (unless explicitly enabled for dev).
- **Dev allowlist**: specific internal hosts can be allowed for development.
- **DNS resolution option**: when enabled, validates that the resolved IP is not private/link-local.

### Download safety

`downloadToTempFile()` enforces:
- Maximum bytes (`STORAGE_MAX_BYTES`, configurable via System Settings).
- Timeout (`STORAGE_DOWNLOAD_TIMEOUT_MS`).
- Content-type prefix allow-list (`STORAGE_ALLOWED_CONTENT_TYPES`).
- Temporary file cleanup in `finally` block.

### Degraded mode

If storage is `none` or the upload fails:
- The asset record stores `storageProvider: 'none'` with the provider URL in `metadata.sourceUrl`.
- The generation is still marked `SUCCEEDED`.
- If storage is configured but the upload fails, the system falls back to the provider's original URL and logs a warning.

### Object key convention

```
{prefix}/images/{yyyy}/{mm}/{dd}/{uuid}.{ext}
{prefix}/videos/{yyyy}/{mm}/{dd}/{uuid}.{ext}
```

The database stores only stable object keys (`storage_provider` + `object_key`), never expiring presigned URLs. For private buckets, the API generates 1-hour presigned GET URLs on read.

## Alternatives Considered

1. **No SSRF guard (trust provider URLs)** — Rejected: provider APIs return URLs that could be manipulated; SSRF is a critical security risk.
2. **Single storage backend (S3 only)** — Rejected: the system needs Qiniu support for China-region deployments and `none` for development.
3. **Fail generation if storage upload fails** — Rejected: object storage is an enhancement, not a dependency. The provider's URL is still valid (temporarily).
4. **Store presigned URLs in the database** — Rejected: presigned URLs expire. Storing stable object keys and generating presigned URLs on read is more durable.

## Consequences

**Positive:**
- Business code depends only on `ObjectStorage` interface — swapping providers doesn't require code changes.
- SSRF protection is enforced for all remote fetches.
- Development works without storage configuration (`none` provider).
- Storage configuration is runtime-adjustable via admin UI.

**Negative:**
- Three storage implementations must be maintained.
- The `none` provider means some assets have no persistent copy — if the provider URL expires, the asset is lost.

## Risks

- SSRF bypass: new private IP ranges or DNS rebinding attacks could bypass the guard. Mitigated by blocklists + optional DNS resolution.
- Qiniu implementation correctness: the native `fetch`/`FormData` implementation differs from S3's AWS SDK.
- Provider URL expiry: if storage is `none` and the provider URL expires, assets become inaccessible.

## Follow-ups

- `AGENTS.md` invariant: "provider 的远程 URL 和媒体下载必须保留 SSRF guard、超时、大小限制和允许的 content type; 不要为了测试简单地移除生产校验."
- `AGENTS.md` invariant: "对象存储默认 provider 为 aws_s3; 后台尚未配置时进程保持可启动并暂时使用 none."
- Admin UI includes a storage connectivity test that uploads, verifies, and deletes a test object.

## References

- [packages/provider/src/storage/](../../packages/provider/src/storage/) — Factory, S3, Qiniu, config
- [packages/provider/src/url-guard.ts](../../packages/provider/src/url-guard.ts) — SSRF guard
- [packages/provider/src/__tests__/url-guard.test.ts](../../packages/provider/src/__tests__/url-guard.test.ts) — SSRF tests
- [apps/worker/src/generation/pipeline.ts](../../apps/worker/src/generation/pipeline.ts) — Download + upload + degraded mode
- [README.md](../../README.md) §对象存储 — Storage documentation
- [docs/product-reference.md](../product-reference.md) §3.6 — Asset and storage product boundary
