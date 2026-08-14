# Performance Experiments

This directory establishes a **framework for recording performance experiments** relevant to EnovaMotion's hot paths. No historical experiments have been fabricated — this is a skeleton for future use.

## Why this exists

EnovaMotion has several performance-sensitive paths where changes to code, configuration, or infrastructure can affect latency, throughput, or cost. Without a structured way to record experiments, the team (or AI agents) may:

1. Re-derive the same benchmark repeatedly.
2. Make changes without knowing the baseline.
3. Forget the reasoning behind a specific timeout, batch size, or poll interval.

## Hot paths

These are the performance-critical areas where experiments should be recorded:

| Path | Key metrics | Config knobs |
|------|-------------|--------------|
| Video generation latency | end-to-end time (submit → poll → download → store → settle) | `video.pollIntervalMs`, `video.maxPolls`, `video.maxWaitMs` |
| Queue wait time | time from DB commit to BullMQ job start | `OutboxDispatcher` poll interval (5s), queue backlog |
| Worker throughput | jobs/min per Worker instance | `queue.workerConcurrency` (restart required) |
| Credential acquire latency | time to acquire a credential lease | `credential.retryAttempts`, `credential.leaseTtlMs` |
| Provider HTTP latency | time for Agnes API calls | `provider.httpTimeoutMs` |
| Download/upload latency | media transfer time | `storage.maxBytes`, `storage.downloadTimeoutMs` |
| DB query latency | wallet lock wait, outbox scan, asset insert | N/A (monitor via query plans) |
| Billing hot path | reserve/settle/release transaction duration | N/A (row lock contention) |
| Retry amplification | number of transient retries before permanent failure | `queue.jobAttempts`, `queue.jobBackoffMs` |

## How to use

1. Copy [TEMPLATE.md](./TEMPLATE.md) to a new file named `YYYY-MM-DD-<short-slug>.md`.
2. Fill in all fields. If you don't have data for a field, write "N/A" and explain why.
3. Commit the experiment file alongside the code change that triggered it.
4. Reference the experiment in the relevant PR or ADR.

## Rules

- **Never fabricate results.** If you didn't run the benchmark, don't create an experiment file.
- **Record the commit SHA** so the experiment is reproducible.
- **Include raw data or links** to logs/metrics screenshots.
- **State the decision** — even if the result is "no change needed."
- **Note regression risk** — what could cause this metric to degrade in the future?

## Index

No experiments have been recorded yet. This section will list them as they are added.
