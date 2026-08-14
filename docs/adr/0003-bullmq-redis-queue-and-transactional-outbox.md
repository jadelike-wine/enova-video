# ADR-0003: BullMQ + Redis Queue with Transactional Outbox

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Generation tasks (image/video) are submitted via the API but executed asynchronously by the Worker. The system must guarantee that:

1. If a generation job is committed to the database, a BullMQ job **will** be enqueued (no orphaned tasks with reserved credits but no queue entry).
2. Duplicate BullMQ events do not cause duplicate execution, settlement, or asset creation.
3. Worker crashes, Redis flushes, or API restarts do not permanently lose tasks.
4. The API and Worker communicate through typed queue payloads, not direct DB polling.

## Decision

Use **BullMQ on Redis** for the generation queue, combined with a **Transactional Outbox pattern**:

- **Enqueue**: `GenerationsService` writes the `generation_jobs` row and a `generation_dispatch_outbox` row in the **same database transaction**. The `OutboxDispatcher` (running on a 5-second interval) scans for `PENDING` outbox rows and calls `queue.add()` with `jobId = generationJobId` for BullMQ idempotent deduplication.
- **Dispatch**: Uses `SELECT ... FOR UPDATE SKIP LOCKED` to allow multi-instance API safe concurrent dispatch.
- **Reconciliation**: `reconcileOrphanJobs()` scans for `QUEUED` generation jobs with no active outbox and replays them. Handles both `SUPERSEDED` (dispatch exhausted) and `DISPATCHED` (BullMQ lost the job) cases.
- **Video polling**: The Worker uses delayed BullMQ jobs (`{ delay: pollIntervalMs, attempts: 1 }`) rather than a separate polling loop. Each poll increment is recorded in the database.
- **Failure semantics**:
  - Transient errors (rate limit, 5xx, timeout) → BullMQ retries with exponential backoff; credits are **not** released on retry.
  - Permanent errors (bad request, provider job failed, poll timeout) → `finalizeFailure()` releases credits and marks job `FAILED` in-method.
  - Final failure (transient retries exhausted) → `worker.on('failed')` in `main.ts` releases credits and marks `FAILED`.

## Alternatives Considered

1. **Direct `queue.add()` after DB commit** — Rejected: if `queue.add()` fails after the DB commit, credits are reserved but the task never executes (orphaned). The outbox pattern eliminates this race.
2. **Cron-based DB polling (no BullMQ)** — Rejected: doesn't support delayed jobs, backoff, or BullMQ's built-in retry semantics. The video polling model relies on BullMQ delayed jobs.
3. **Kafka / RabbitMQ** — Rejected: too heavy for a single EC2 instance. Redis is already required for credential leases and rate limiting.

## Consequences

**Positive:**
- Atomic DB+queue consistency via outbox.
- Multi-instance API safety via `SKIP LOCKED`.
- BullMQ idempotent jobId deduplication prevents duplicate execution.
- Reconciliation self-heals orphaned tasks without manual intervention.

**Negative:**
- Up to 5 seconds of latency between DB commit and BullMQ enqueue (acceptable for generation tasks).
- The reconciliation logic is complex — must handle `SUPERSEDED` vs `DISPATCHED` vs `PENDING` states correctly.
- Video polling uses BullMQ delayed jobs with `attempts: 1` — poll governance is by `pollIntervalMs / maxPolls / maxWaitMs`, not BullMQ retry.

## Risks

- Outbox dispatcher stops running (timer error) → tasks pile up as `PENDING`. Mitigated by error logging in `dispatchBatch()` and `reconcileOrphanJobs()`.
- BullMQ Redis data loss → `reconcileOrphanJobs()` recovers by replaying from the outbox.
- Queue payload schema changes require coordinated updates to API (producer), Worker (consumer), `packages/contracts`, and tests.

## Follow-ups

- `AGENTS.md` mandates: "修改队列 payload 时同步更新生产者、消费者、测试和必要的迁移兼容逻辑."
- Queue job options (`attempts`, `backoffMs`) are dynamically configurable via System Settings (`queue.jobAttempts`, `queue.jobBackoffMs`).
- `BACKUP.md` documents that Redis does not need daily backup because the outbox provides recovery from PostgreSQL.

## References

- [apps/api/src/generations/outbox.dispatcher.ts](../../apps/api/src/generations/outbox.dispatcher.ts) — Outbox implementation
- [apps/api/src/generations/generations.service.ts](../../apps/api/src/generations/generations.service.ts) — Transactional job creation
- [apps/worker/src/generation/pipeline.ts](../../apps/worker/src/generation/pipeline.ts) — Worker pipeline with transient/permanent failure semantics
- [apps/worker/src/main.ts](../../apps/worker/src/main.ts) — `worker.on('failed')` final failure handler
- [packages/contracts/](../../packages/contracts/) — Shared queue payload types
- [docs/BACKUP.md](../BACKUP.md) — Redis backup strategy (not needed due to outbox)
