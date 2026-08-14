# Performance Experiment Template

## Experiment ID

[YYYY-MM-DD-<short-slug>]

## Date

[YYYY-MM-DD]

## Owner

[Person or agent who ran the experiment]

## Hypothesis

[What do you expect to happen? e.g., "Increasing pollIntervalMs from 5s to 10s will reduce Redis load by 50% without significantly increasing end-to-end latency."]

## System / Commit

- **Commit SHA:** [git rev-parse HEAD]
- **Branch:** [branch name]
- **App version:** [cat VERSION]

## Environment

- **Machine:** [EC2 instance type / local specs]
- **Node.js version:** [node --version]
- **PostgreSQL version:** [16]
- **Redis version:** [7]
- **Docker:** [yes/no]
- **Other notes:** [e.g., "single Worker instance", "no background load"]

## Workload

[Describe the workload: number of jobs, type (image/video), provider, concurrency level, etc.]

## Baseline

[Metric values before the change. e.g., "median end-to-end video latency: 45s, P95: 60s, Redis ops/s: 120"]

## Change

[Describe the change being tested. e.g., "Changed video.pollIntervalMs from 5000 to 10000 via System Settings"]

## Metrics

| Metric | Baseline | After change | Delta |
|--------|----------|-------------|-------|
| [Metric name] | [value] | [value] | [±%] |

## Results

[Interpret the metrics. Was the hypothesis confirmed? Were there unexpected side effects?]

## Interpretation

[What does this mean for the system? Is this change safe to keep? Should it be reverted?]

## Decision

[Final decision: "adopted", "reverted", "needs more data", "abandoned"]

## Regression Risk

[What could cause this metric to degrade in the future? e.g., "If more Workers are added, Redis eval contention may increase."]

## Raw Data / Links

[Links to logs, metrics dashboards, screenshots, or raw data files.]
