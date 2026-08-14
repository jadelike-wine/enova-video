# ADR-0004: Credits Wallet — Reserve / Settle / Release with Per-Job Reservations

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The billing system must:

1. **Prevent concurrent oversell**: multiple generation tasks created simultaneously on the same wallet must not overdraw the balance.
2. **Be idempotent**: duplicate BullMQ events (retries, reconciliation) must not cause duplicate charges, settlements, or refunds.
3. **Handle partial settlement**: the estimated cost may differ from the actual cost — unused credits must be returned.
4. **Survive crashes**: if the Worker crashes mid-task, the reserved credits must be recoverable.

## Decision

Use a **three-phase wallet model** (Reserve / Settle / Release) with **per-job credit reservations**:

- Each `GenerationJob` gets its own `credit_reservations` row (unique on `generation_job_id`).
- **Reserve**: `balance -= credits`, `reservedBalance += credits`, create reservation row + ledger entry in one transaction. Uses `SELECT ... FOR UPDATE` on the wallet row to serialize concurrent reserves.
- **Settle (Capture)**: consumes `actualCredits` from the reservation; remaining reserved credits return to `balance`. Reservation status → `CAPTURED`. Ledger records settlement (amount=0, since credits were already deducted at reserve time) and any release of unused portion.
- **Release**: returns all remaining reserved credits from a specific job's reservation to `balance`. Reservation status → `RELEASED`.

**Idempotency guarantees (database-enforced):**

| Constraint | Purpose |
|-----------|---------|
| `credit_reservations.generation_job_id` UNIQUE | One job → one reservation |
| `credit_reservations.idempotency_key` UNIQUE | Duplicate reserve is idempotent |
| `wallet_ledger.idempotency_key` UNIQUE | Duplicate settle/release is idempotent |
| `captured + released <= reserved` CHECK | Prevents over-capture/over-release |

**P0 red-team fix**: The idempotency check for duplicate reserve must happen **after** acquiring the `FOR UPDATE` row lock, not before. The original code checked before locking, allowing two concurrent reserves for the same job to both see "no reservation" and both proceed, causing a unique constraint violation. The fix (visible in `reserveInTx`) moves the idempotency check inside the lock scope.

## Alternatives Considered

1. **Aggregate `reservedBalance` without per-job rows** — Rejected (was the original design): settling or releasing a job required modifying the aggregate `reservedBalance`, which was error-prone under concurrency. If two jobs completed simultaneously, the aggregate could be miscomputed. Per-job reservations make settle/release independent.
2. **Two-phase commit (2PC) across DB and provider** — Rejected: provider APIs (Agnes) don't support 2PC. The three-phase model decouples provider execution from DB settlement.
3. **Float arithmetic** — Rejected: credits are integers (bigint), costs are micro-USD integers. All money math uses integer arithmetic to avoid floating-point errors.

## Consequences

**Positive:**
- No oversell under concurrency (row-level locking).
- Duplicate events are safe (unique constraints + idempotency keys).
- Per-job isolation: settling one job doesn't touch another job's reservation.
- Crash recovery: if the Worker crashes after reserve, the reservation persists and can be released by `worker.on('failed')` in `main.ts`.

**Negative:**
- Every reserve/settle/release requires a database transaction with row locks.
- The idempotency logic is subtle — the P0 fix demonstrates that even well-intentioned idempotency checks can be racy without proper lock ordering.
- Three-phase model means the wallet has both `balance` and `reservedBalance` — consumers must understand the difference.

## Risks

- Deadlock between concurrent reserve/settle on the same wallet — mitigated by consistent lock ordering (wallet row first, then reservation row).
- Long-running transactions holding wallet row locks could block other operations. Current transaction scope is tight (no provider calls inside the transaction).

## Follow-ups

- `AGENTS.md` invariant: "worker 最终失败时必须幂等释放预留 credits, 并把 generation 标记为失败; 重复的 BullMQ 事件不能重复退款."
- Integration test: `packages/billing/src/wallet.concurrency.integration.spec.ts` tests crash recovery, duplicate capture/release idempotency, and concurrent reserve.
- `product-reference.md` §5.2 documents the billing state machine.

## References

- [packages/billing/src/wallet.ts](../../packages/billing/src/wallet.ts) — `WalletGateway` implementation with `reserveInTx`, `captureInTx`, `releaseInTx`
- [packages/billing/src/wallet.spec.ts](../../packages/billing/src/wallet.spec.ts) — Idempotency invariant tests
- [packages/billing/src/wallet.concurrency.integration.spec.ts](../../packages/billing/src/wallet.concurrency.integration.spec.ts) — Concurrency integration tests
- [packages/db/src/schema.ts](../../packages/db/src/schema.ts) — `credit_reservations` and `wallet_ledger` tables
- [apps/worker/src/generation/pipeline.ts](../../apps/worker/src/generation/pipeline.ts) — Settle on success, release on failure
- [docs/product-reference.md](../product-reference.md) §5.2 — Billing state diagram
- Commit `527776f` — "P0 商业化收口——支付/退款策略、计费并发与商户管理后台"
