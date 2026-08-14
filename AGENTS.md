# AGENTS.md

## 项目概览

EnovaMotion（灵动创影）是一个 AI Creator SaaS，面向 Agnes AI 提供对话、图片生成和视频生成能力。

开始处理产品功能或用户流程前，先阅读 [docs/README.md](./docs/README.md) 和 [docs/product-reference.md](./docs/product-reference.md)。前者是 Codex/Agent 的文档入口，后者记录当前已实现产品能力、领域模型、状态机和“已实现/预留/部分实现”边界；它们不替代具体功能的设计文档。

当前仓库为**单一新架构（monorepo）**：`apps/api`、`apps/worker`、`apps/web` 和 `packages/*`。技术栈是 Node.js 20+、TypeScript、NestJS/Fastify、Drizzle、PostgreSQL、Redis/BullMQ 和 Next.js 15。旧架构的 `backend`（FastAPI + SQLite）与 `frontend` 目录已删除，不再存在。

所有新业务能力与现有功能修复均默认在新架构内完成。

## 目录职责

- `apps/api`：NestJS API、认证/session、对话、生成任务、计费、支付、管理后台和队列生产者。
- `apps/worker`：BullMQ 生成任务消费者；负责调用 provider、轮询视频任务、下载/转存结果及最终失败退款。
- `packages/contracts`：跨 API、worker、SDK 使用的类型、枚举、错误码和队列契约。
- `packages/config`：通过 Zod 加载并校验新架构环境变量。
- `packages/db`：Drizzle PostgreSQL schema、数据库连接和迁移配置。
- `packages/provider`：Agnes provider、provider registry、凭证加密/租约、SSRF 防护和对象存储。
- `packages/billing`：钱包和 credits 领域逻辑；应保持 NestJS 无关。
- `packages/payment`：支付渠道抽象及 sandbox/微信/支付宝适配器。
- `packages/sdk`：由 `apps/api/openapi.json` 生成的客户端类型和 HTTP client。
- `packages/migrator`：旧 SQLite 数据向新架构迁移的 CLI/辅助逻辑。
- `apps/web`：新架构对应的 Next.js 应用。
- `scripts`：生产更新、回滚和辅助 shell 脚本；涉及 PostgreSQL 备份和回滚时要格外谨慎。

## 环境与启动

要求 Node.js `>=20`，包管理器为 pnpm `10.27.0`。首次进入新架构时：

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env
```

新架构常用命令：

```bash
pnpm dev             # 所有新架构 workspace 的开发进程
pnpm dev:api         # API，默认 3001
pnpm dev:worker      # 生成任务 worker
pnpm --filter @enova/web dev  # 新前端，默认 3000
pnpm db:generate     # 生成 Drizzle migration
pnpm db:migrate      # 执行 PostgreSQL migration
pnpm sdk:generate    # 根据 apps/api/openapi.json 生成 SDK 类型
```

提交前优先运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

只改一个 workspace 时，使用对应的 `pnpm --filter <package> <script>`，缩短反馈时间。仓库测试统一使用 `pnpm test`（Vitest）。

## 生产运维

生产服务器访问、Docker 部署/回滚、诊断与清理等操作，见 [docs/OPS.md](./docs/OPS.md)。涉及线上部署、数据库回滚或删除数据等不可逆操作时，先与用户确认。

## AWS EC2 SSH / Instance Connect

当通过 AWS EC2 Instance Connect 连接实例时，临时 SSH 公钥只有约 60 秒有效期。

* 如果出现“公钥过期”“SSH key expired”或类似错误，不要停止任务或要求用户重新操作。
* 自动重新执行公钥注入，并立即重试 SSH 连接。
* 公钥注入和 SSH 建连应尽量连续执行，避免在两者之间进行耗时操作。
* 优先使用 `aws ec2-instance-connect ssh` 完成连接；如果必须使用 `send-ssh-public-key`，则在注入成功后立即执行对应的 `ssh` 命令。
* 60 秒限制只影响建立连接之前的临时公钥；SSH 会话成功建立后，无需因为公钥过期而重新连接。
* 遇到此类临时凭证过期错误时，应自动恢复并继续原任务，不要将其视为需要用户介入的失败。

## 开发约定

- TypeScript 源码使用 ESM 风格导入；本地相对导入保留 `.js` 后缀，和现有 `tsconfig`/编译产物一致。
- 新 API 遵循 NestJS module/controller/service 结构。输入 DTO 使用 `class-validator`，全局校验已开启；不要绕过 DTO 直接信任请求体。
- 领域逻辑优先放在 `packages/*`，保持可被 API 和 worker 复用，不把数据库或 NestJS 依赖无必要地泄漏进纯领域包。
- API 与 worker 通过 `packages/contracts` 和 BullMQ payload 通信；修改队列 payload 时同步更新生产者、消费者、测试和必要的迁移兼容逻辑。
- API 变更后启动 API 重新生成 `apps/api/openapi.json`，再运行 `pnpm sdk:generate`；不要手工编辑生成的 SDK 文件。
- 数据库 schema 改动必须通过 Drizzle migration；不要只改 `packages/db/src/schema.ts` 而跳过 migration。
- 认证、credits、支付、任务状态和凭证租约属于高风险逻辑。优先使用现有的幂等键、事务和状态机，避免重复扣费、重复退款或重复处理任务。
- provider 的远程 URL 和媒体下载必须保留 SSRF guard、超时、大小限制和允许的 content type；不要为了测试简单地移除生产校验。
- Redis 上的凭证并发控制是跨 worker 的一致性边界，不能退化为进程内 `Map`。
- 用户 prompt、API key、session secret、provider secret 和支付凭证不能写入日志、测试快照或 `NEXT_PUBLIC_*` 环境变量。
- UI 改动统一在 `apps/web`。保持现有 Next.js App Router、Tailwind 和项目已有的组件/样式风格。
- 修改应小而聚焦；不要顺手格式化整个仓库，也不要提交 `node_modules`、`.next`、`.venv`、`dist`、数据库文件、备份或真实 `.env`。

## 新架构的重要不变量

- worker 最终失败时必须幂等释放预留 credits，并把 generation 标记为失败；重复的 BullMQ 事件不能重复退款。
- provider 凭证使用 `CREDENTIAL_MASTER_KEY` 加密；生产环境禁止使用 `.env.example` 中的 dev 占位密钥。
- 生产环境的 `CREDENTIAL_MASTER_KEY`、数据库和 Redis 只能通过服务端环境或 IAM/角色注入；对象存储凭证可使用管理员后台的 AES-GCM 加密系统设置，未设置时才从服务端环境或 IAM/角色读取。
- 对象存储默认 provider 为 `aws_s3`；后台尚未配置时进程保持可启动并暂时使用 `none`，S3/七牛配置必须与实际 provider 分支一致。
- `docker-compose.dev.yml` 仅用于新架构本地 PostgreSQL/Redis，不代表生产部署方案。

## 变更后的验证

根据改动范围至少执行相关 workspace 的 lint、typecheck 和 test；涉及跨 workspace、schema、OpenAPI 或构建流程时执行根目录 `pnpm lint && pnpm typecheck && pnpm test && pnpm build`。如果无法执行某项，说明具体原因，不要把“未运行”写成“通过”。

报告结果时说明：改了哪些目录、验证了哪些命令、是否触碰迁移/生成文件，以及是否仍存在新旧架构边界或环境配置风险。
