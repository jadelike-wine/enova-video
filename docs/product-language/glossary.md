# Glossary

Canonical terms for EnovaMotion (灵动创影). Code-level representation refers to the TypeScript constant, type, or database column.

---

## Generation & Task

### GenerationJob

- **Canonical term:** GenerationJob
- **中文:** 生成任务
- **English:** Generation job
- **Code:** `generation_jobs` table, `GenerationJob` type, `GENERATION_TYPES` enum
- **Discouraged synonyms:** task, render, request, job (without "generation" prefix)
- **Why it matters:** "Job" alone is ambiguous in a BullMQ context (BullMQ jobs are queue items, not domain tasks). "GenerationJob" unambiguously refers to the domain entity with a state machine.

### GenerationType

- **Canonical term:** GenerationType
- **中文:** 生成类型（图片 / 视频）
- **English:** Generation type (image / video)
- **Code:** `GENERATION_TYPES = { IMAGE, VIDEO, AUDIO, UPSCALE, LIPSYNC, IMAGE_TO_VIDEO, VIDEO_TO_VIDEO }`
- **Note:** `AUDIO`, `UPSCALE`, `LIPSYNC`, `IMAGE_TO_VIDEO`, `VIDEO_TO_VIDEO` are **reserved in the enum but not implemented** in the product. Do not assume they are available just because the enum exists.

### GenerationStatus (State Machine)

- **Canonical term:** GenerationStatus
- **中文:** 生成状态
- **English:** Generation status
- **Code:** `GENERATION_STATUSES = { PENDING, QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELED }`

| Status | 中文 | Meaning |
|--------|------|---------|
| `PENDING` | 待处理 | Job created, not yet queued |
| `QUEUED` | 已入队 | Outbox dispatched to BullMQ |
| `RUNNING` | 执行中 | Worker is processing (provider call, polling, download) |
| `SUCCEEDED` | 成功 | Completed, asset stored, credits settled |
| `FAILED` | 失败 | Terminal failure, credits released |
| `CANCELED` | 已取消 | User or system cancelled, credits released |

- **Discouraged synonyms:** "completed" (use `SUCCEEDED`), "cancelled" (use `CANCELED` — one L, matching the enum), "processing" (use `RUNNING`), "done" (use `SUCCEEDED` or `FAILED`)
- **Why it matters:** The state machine enforces legal transitions in code. Using the wrong term in discussion or docs leads to incorrect assumptions about what states are reachable.

### Asset

- **Canonical term:** Asset
- **中文:** 媒体资产
- **English:** Media asset
- **Code:** `assets` table, `ASSET_TYPES = { IMAGE, VIDEO, UPLOAD }`
- **Discouraged synonyms:** file, output, result, media
- **Why it matters:** "Asset" specifically refers to a persisted, addressable media object with storage metadata. A provider-returned URL is not an Asset until it is stored.

---

## Billing & Credits

### Credits

- **Canonical term:** Credits
- **中文:** Credits（额度）
- **English:** Credits
- **Code:** `bigint` in `wallets.balance`, `wallets.reservedBalance`, `credit_reservations.*`
- **Discouraged synonyms:** tokens, points, coins, balance (balance is the *amount* of credits, not the unit)
- **Why it matters:** Credits are the universal usage unit. They are always integers (1 credit = 1 unit). Mixing with "tokens" could confuse with LLM tokens.

### Wallet

- **Canonical term:** Wallet
- **中文:** 钱包
- **English:** Wallet
- **Code:** `wallets` table, per-Workspace
- **Discouraged synonyms:** account, balance, purse
- **Why it matters:** A Wallet has both `balance` (available) and `reservedBalance` (held for in-flight jobs). Saying "wallet balance" is ambiguous — specify available or reserved.

### Reserve / Settle / Release

- **Canonical terms:** Reserve, Settle (Capture), Release
- **中文:** 预留 / 结算 / 释放
- **English:** Reserve / Settle (Capture) / Release
- **Code:** `WalletGateway.reserve()`, `WalletGateway.capture()` (alias: `settle()`), `WalletGateway.release()`

| Term | 中文 | When | Effect on balance | Effect on reserved |
|------|------|------|--------------------|--------------------|
| Reserve | 预留 | Job creation | `balance -= credits` | `reservedBalance += credits` |
| Settle (Capture) | 结算 | Job success | `balance += unused` | `reservedBalance -= remaining` |
| Release | 释放 | Job failure/cancel | `balance += all_reserved` | `reservedBalance -= all_reserved` |

- **Discouraged synonyms:** "charge" (use Settle), "refund" (use Release), "hold" (use Reserve), "deduct" (use Reserve)
- **Note:** `capture()` is the canonical method name; `settle()` is a backward-compatible alias. Both are acceptable in discussion.
- **Why it matters:** The three-phase model is a core invariant. Confusing Reserve with Settle could lead to double-charging logic.

### WalletLedger

- **Canonical term:** WalletLedger
- **中文:** 钱包账本
- **English:** Wallet ledger
- **Code:** `wallet_ledger` table, `WALLET_LEDGER_TYPES` enum
- **Discouraged synonyms:** transaction, log, history
- **Why it matters:** Ledger entries are **immutable** and carry `idempotency_key` uniqueness. "Transaction" is ambiguous (DB transaction vs financial transaction).

---

## Provider & Credentials

### Provider

- **Canonical term:** Provider
- **中文:** AI 服务提供方
- **English:** AI service provider
- **Code:** `providers` table, `ProviderRegistry`, `AIProvider` interface
- **Discouraged synonyms:** vendor, upstream, API (too generic)
- **Why it matters:** "Provider" is the abstraction layer. Currently only Agnes is implemented, but the interface supports multiple providers.

### ProviderCredential

- **Canonical term:** ProviderCredential
- **中文:** Provider 凭证
- **English:** Provider credential
- **Code:** `provider_credentials` table, `RedisCredentialManager`
- **Discouraged synonyms:** API key, secret, token
- **Why it matters:** A credential is an encrypted entity with status (`ACTIVE`, `COOLDOWN`, `ERROR`, `DISABLED`), concurrency limits, and lease lifecycle. Calling it "API key" loses the status/lease semantics.

### CredentialStatus

- **Canonical term:** CredentialStatus
- **Code:** `CREDENTIAL_STATUSES = { ACTIVE, COOLDOWN, ERROR, DISABLED }`

| Status | 中文 | Meaning |
|--------|------|---------|
| `ACTIVE` | 可用 | Encrypted and available for acquisition |
| `COOLDOWN` | 冷却中 | 429 received, auto-recovers after `cooldownUntil` |
| `ERROR` | 错误 | 401/403 received, requires manual/health-check recovery |
| `DISABLED` | 已禁用 | Admin disabled |

---

## Payment

### Order

- **Canonical term:** Order
- **中文:** 订单
- **English:** Order
- **Code:** `orders` table, `PAYMENT_STATUSES` and fulfillment status tracked independently
- **Discouraged synonyms:** purchase, transaction
- **Why it matters:** An Order has separate payment status and fulfillment status. Calling it "transaction" conflates with `payment_transactions`.

### PaymentTransaction

- **Canonical term:** PaymentTransaction
- **中文:** 支付流水
- **English:** Payment transaction
- **Code:** `payment_transactions` table
- **Discouraged synonyms:** payment, charge, payment record
- **Why it matters:** A PaymentTransaction is the provider-side record (e.g., Alipay/WeChat callback). An Order is the domain-side record.

---

## Infrastructure

### Workspace

- **Canonical term:** Workspace
- **中文:** 工作区
- **English:** Workspace
- **Code:** `workspaces` table, `WORKSPACE_TYPES = { PERSONAL, TEAM }`
- **Discouraged synonyms:** org, tenant, project
- **Why it matters:** Workspace is the **isolation and billing unit**. All resources (jobs, wallets, assets, orders) are Workspace-scoped. IDOR protection requires Workspace ID on every query.

### Outbox

- **Canonical term:** Outbox (Transactional Outbox)
- **中文:** 事务发件箱
- **English:** Transactional outbox
- **Code:** `generation_dispatch_outbox` table, `OutboxDispatcher`
- **Discouraged synonyms:** queue, dispatcher, relay
- **Why it matters:** The outbox ensures DB commit + BullMQ enqueue atomicity. It is not the queue itself — it is the bridge between DB and queue.

### System Settings

- **Canonical term:** System Settings
- **中文:** 系统设置
- **English:** System settings
- **Code:** `settings` table, `SettingsService`, `SettingsRegistry`
- **Discouraged synonyms:** config, environment, env vars
- **Why it matters:** System Settings are database-managed, runtime-adjustable, and take precedence over env vars. Env vars are bootstrap-only. See [ADR-0006](../adr/0006-bootstrap-env-vs-runtime-system-settings.md).
