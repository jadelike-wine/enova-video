# EnovaMotion 文档入口

这组文档面向产品、开发者和 Codex/Agent。文档只描述当前仓库能够从代码、页面或配置中验证的事实；如果某项能力只存在于数据库枚举、接口预留或旧 README 中，不应直接当作已上线产品能力。

---

## Start Here — Agent Reading Order

不同任务类型，先读什么：

### 修改产品行为（新增/修改用户可见功能）

1. [CLAUDE.md](../CLAUDE.md) — 快速上下文
2. [AGENTS.md](../AGENTS.md) — 目录职责、工程约定、安全不变量
3. [product-reference.md](./product-reference.md) — 产品能力矩阵、状态机、领域模型
4. 相关 [ADR](./adr/) — 架构约束（如 billing model、storage abstraction）
5. 相关 [Plan](./plans/) — 如果有已完成的实现计划
5. [product-language/glossary.md](./product-language/glossary.md) — 确保使用正确术语

### 修改 Billing / Credits

1. [product-reference.md](./product-reference.md) §5 — 计费状态机和不变量
2. [ADR-0004](./adr/0004-credits-reserve-settle-release-wallet.md) — Reserve/Settle/Release 模型
3. [packages/billing/src/wallet.ts](../packages/billing/src/wallet.ts) — `WalletGateway` 实现
4. [ADR-0003](./adr/0003-bullmq-redis-queue-and-transactional-outbox.md) — 队列与结算的协作
5. [packages/billing/src/wallet.concurrency.integration.spec.ts](../packages/billing/src/wallet.concurrency.integration.spec.ts) — 并发测试

### 修改 Video Pipeline

1. [ADR-0003](./adr/0003-bullmq-redis-queue-and-transactional-outbox.md) — Outbox + BullMQ + 轮询
2. [product-reference.md](./product-reference.md) §3.4 — 视频生成能力
3. [apps/worker/src/generation/pipeline.ts](../apps/worker/src/generation/pipeline.ts) — Pipeline 实现
4. [ADR-0007](./adr/0007-object-storage-abstraction-and-ssrf-guard.md) — 存储与 SSRF
5. [perf-experiments/](./perf-experiments/) — 如有性能实验记录

### 修改 Provider / Credentials

1. [ADR-0005](./adr/0005-provider-credential-encryption-and-redis-lease.md) — 加密 + Redis lease
2. [packages/provider/src/credential-manager/redis-credential-manager.ts](../packages/provider/src/credential-manager/redis-credential-manager.ts)
3. [AGENTS.md](../AGENTS.md) — 安全不变量（CREDENTIAL_MASTER_KEY、SSRF guard）
4. [product-reference.md](./product-reference.md) §7 — Provider 产品边界

### 做部署 / 生产操作

1. [OPS.md](./OPS.md) — 服务器信息、诊断命令、系统更新
2. [BACKUP.md](./BACKUP.md) — 备份策略
3. [ADR-0008](./adr/0008-versioned-release-with-health-check-rollback.md) — 版本发布与回滚
4. [AGENTS.md](../AGENTS.md) — 不可逆操作需确认

### 调查历史设计原因

1. [ADR index](./adr/README.md) — 已记录的架构决策
2. [Plans](./plans/README.md) — 实现计划
3. [CHANGELOG.md](../CHANGELOG.md) — 版本变更记录
4. Git history — 最终事实来源

### 修改配置 / 环境变量

1. [ADR-0006](./adr/0006-bootstrap-env-vs-runtime-system-settings.md) — Bootstrap env vs System Settings
2. [.env.example](../.env.example) — 当前 bootstrap 变量
3. [packages/db/src/settings-registry.ts](../packages/db/src/settings-registry.ts) — 运行时设置定义

---

## Source-of-Truth Matrix

| 信息类型 | 权威来源 |
|---------|---------|
| Agent rules & invariants | [CLAUDE.md](../CLAUDE.md) / [AGENTS.md](../AGENTS.md) |
| Product / domain facts | [product-reference.md](./product-reference.md) |
| Architectural decisions | [docs/adr/](./adr/) |
| Planned implementation | [docs/plans/](./plans/) |
| Historical changes | [CHANGELOG.md](../CHANGELOG.md) |
| Operations | [OPS.md](./OPS.md) |
| Backup / restore | [BACKUP.md](./BACKUP.md) |
| Terminology | [docs/product-language/](./product-language/) |
| Performance evidence | [docs/perf-experiments/](./perf-experiments/) |
| Deep research | [deep-research-reports/](../deep-research-reports/) |

---

## 文档职责

| 文档 | 负责回答的问题 |
| --- | --- |
| `product-reference.md` | 这个产品是什么、用户能做什么、哪些能力已实现、核心概念如何对应代码？ |
| `../README.md` | 项目如何运行、代码如何组织、系统由哪些进程组成？ |
| `AGENTS.md` | Agent 修改代码时必须遵守哪些边界和不变量？ |
| `OPS.md` | 如何进行生产运维，以及哪些操作需要额外谨慎？ |
| `BACKUP.md` | 如何备份和恢复数据？ |
| `adr/` | 为什么选择了这个架构？有哪些替代方案？后果和风险是什么？ |
| `plans/` | 具体功能是如何实现的？步骤是什么？ |
| `product-language/` | 项目中应该用什么词描述某个概念？ |
| `perf-experiments/` | 性能基准是多少？某次变更对性能的影响是什么？ |
| `../CHANGELOG.md` | 每个版本发生了什么用户/运维关心的变化？ |

---

## 产品文档维护规则

- 新增或移除用户可见能力时，先更新 `product-reference.md` 的功能矩阵和用户流程。
- 只更新数据库 schema 或共享枚举，不等于产品能力已发布；要区分"已实现""预留/未开放"和"运维能力"。
- 文档中的模型名、路由、状态和目录应尽量链接到实现文件，便于 Agent 继续追踪。
- 不在文档中写入 API Key、密码、Session Secret、Provider Secret、支付凭证或真实环境值。
- 产品定位以当前代码为准；历史 README 或旧架构描述与代码冲突时，应在文档中指出差异并以新 monorepo 为准。

## 当前文档状态

- 产品事实参考：已建立，维护当前新架构的产品能力和领域边界。
- ADR：已建立，覆盖 9 项已确认架构决策（见 `adr/README.md` 索引）。
- 实现计划：已建立，索引现有 plan 并提供模板。
- CHANGELOG：已建立，回填 v1.1.0–v1.4.0 可确认里程碑。
- 术语表：已建立，覆盖 generation、billing、provider、payment、infrastructure 核心术语。
- 性能实验：框架已建立，暂无历史实验记录。
- 用户帮助中心：尚未建立；本目录不是面向终端用户的完整使用手册。
