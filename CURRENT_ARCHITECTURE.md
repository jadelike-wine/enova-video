# CURRENT_ARCHITECTURE — enova-video 现状分析

> 本文档是面向商业化 SaaS 后端重构的 **Phase 0 产物**。
> 基于对当前仓库的完整扫描（backend/ + frontend/ + scripts/ + .github/ + docker-compose）。
> 目标：如实记录现状、指出安全/架构缺口、输出复用清单与迁移计划，**不在此阶段改动业务代码**。

---

## 1. 当前目录结构

```
enova-video/
├── backend/                      # FastAPI (Python) 单体后端
│   ├── app/
│   │   ├── main.py               # FastAPI 入口 + APScheduler 定时视频轮询
│   │   ├── config.py             # 环境变量 + 模型列表 + 视频并发开关
│   │   ├── database.py           # SQLite 连接 + 幂等迁移 + get_db()
│   │   ├── schemas.py            # Pydantic 请求/响应模型
│   │   ├── core/logging.py       # 结构化日志 + request_id/task_id + 脱敏
│   │   ├── routers/              # chat / images / videos / settings / system
│   │   └── services/
│   │       ├── agnes_client.py   # Agnes OpenAI 兼容 HTTP 客户端（chat/image/video）
│   │       ├── api_key_pool.py   # 内存版 Token Pool（RR + 冷却 + in-flight）
│   │       ├── api_key_service.py# API Key CRUD（明文存储）
│   │       ├── app_settings_service.py # Base URL 设置
│   │       ├── storage_settings.py      # 存储配置（DB + env 合并）
│   │       ├── storage/          # base / factory / none / qiniu / s3
│   │       ├── qiniu_service.py
│   │       ├── video_poller.py   # 轮询视频状态 + 转存
│   │       ├── token_utils.py    # token 估算
│   │       ├── version_service.py
│   │       └── error_utils.py    # 稳定错误码 + 异常分类
│   ├── sql/schema.sql            # SQLite 建表
│   ├── tests/                    # api_key_pool / logging / storage / system
│   ├── Dockerfile / requirements.txt / .env.example
│   └── database/aimodel.db       # SQLite 数据文件（gitignore）
├── frontend/                     # Next.js 15 App Router
│   ├── app/                      # 营销页 + /app 交互区 + SEO(robots/sitemap)
│   ├── components/               # marketing/ + application/
│   ├── lib/                      # api.ts / models.ts / seo.ts / tokens.ts ...
│   ├── next.config.mjs           # /api/* rewrite → BACKEND_URL
│   └── Dockerfile / package.json / eslint.config.mjs
├── scripts/                      # update.sh / rollback.sh / lib.sh
├── .github/workflows/            # ci / deploy / release
├── docker-compose.yml / docker-compose.prod.yml
├── .env.example / VERSION / README.md / README_EN.md
```

**结论**：当前是「Next.js(SSR) + FastAPI + SQLite」的两进程单体，单租户、无鉴权、无计费。

---

## 2. 当前数据库模型（SQLite，`backend/sql/schema.sql`）

| 表 | 关键列 | 备注 |
|---|---|---|
| `conversations` | id, title, model, created_at, updated_at | 无 user/workspace 归属 |
| `messages` | id, conversation_id, role, content, prompt_tokens, completion_tokens, total_tokens, duration_ms, model | FK→conversations ON DELETE CASCADE |
| `image_tasks` | id, model, mode, prompt, size, input_images, output_url, qiniu_url, storage_provider, storage_key, revised_prompt, duration_ms, status, error_message, request_params | status ∈ pending/processing/completed/failed |
| `video_tasks` | id, model, mode, prompt, negative_prompt, task_id, video_id, width, height, num_frames, frame_rate, status, progress, seconds, size, output_url, qiniu_url, storage_provider, storage_key, api_key_id, request_params | status ∈ submitting/queued/in_progress/completed/failed |
| `uploads` | id, filename, qiniu_key, qiniu_url, file_type, size_bytes | 上传记录 |
| `api_keys` | id, name, api_key, is_active, is_enabled | **Secret 明文存储** |
| `app_settings` | key, value | Base URL / 存储配置键值对 |

迁移方式：`init_db()` 用 `executescript(schema.sql)` + 若干 `ALTER TABLE` 幂等迁移（视频状态、存储列、key 开关）。无版本化 migration 工具。

**缺口**：无 `users`、`workspaces`、`wallet`、`pricing`、`usage`、`provider`、`credential` 等任何 SaaS 表；`image_tasks`/`video_tasks` 是两套平行任务表，未统一。

---

## 3. 当前图片生成链路（同步）

```
POST /api/images/generate
  → 校验 body（Pydantic）或 multipart（先上传参考图到存储）
  → 插入 image_tasks(status=processing)
  → agnes_client.generate_image(payload)   // 同步 HTTP，timeout=360s
  → _complete_image_task(task_id, result)
      → 若有 url：storage.upload_from_url(out_url, "img")
      → 若有 b64：storage.upload_bytes(...)
      → 更新 image_tasks: status=completed + storage_provider/storage_key
  → 返回序列化行（resolve_display_url 动态生成 presigned URL）
```

关键点：
- **同步阻塞**：整个 HTTP 请求一直等到 Agnes 返回（最长 360s）。图片尚可，但不符合「异步任务」原则。
- 失败：`status=failed` + error_code 分类。
- 前端 `imageApi.generate()` 直接等待结果；历史通过 `/tasks` `/tasks/:id` `/tasks/:id/sync` 拉取。

---

## 4. 当前视频生成链路（半异步 + 进程内轮询）

```
POST /api/videos/generate
  → 插入 video_tasks(status=submitting)
  → FastAPI background_tasks.add_task(_submit_to_agnes, task_id, payload)
_submit_to_agnes:
  → _create_video_with_retry(task_id, payload)
      → get_video_concurrency_semaphore()       // 全局 asyncio.Semaphore(3)
      → async with api_key_pool.acquire() as key // Token Pool 选择
      → agnes_client.create_video(...)           // POST /v1/videos, timeout=120s
      → 429→冷却+重试；401/403→标记不可用；400→不重试；5xx/超时→指数退避
  → 更新 video_tasks: task_id/video_id/status/progress/seconds/size
APScheduler（每 15s，进程内）:
  → poll_pending_videos() → refresh_task_from_agnes(task_id, video_id, model)
      → agnes_client.get_video_status()          // GET /agnesapi?video_id=&model_name=
      → status=completed → output_url → background thread upload_from_url → 存 storage_key
      → status=failed → 记录 error_message
前端轮询 /api/videos/tasks/:id/sync 刷新状态。
```

关键点：
- **进程内调度**：APScheduler + 内存状态，Worker crash / 多实例部署会丢轮询与并发控制。
- **线程里起线程**：转存用 `threading.Thread` 后台执行，非可靠任务队列。
- 重试/退避/冷却当前已是「内聚在 client + pool」，是重构时可直接平移的成熟逻辑。

---

## 5. 当前 Agnes API Key Pool 工作方式

文件：`backend/app/services/api_key_pool.py`（内存单例 `api_key_pool`）。

- **装载**：`is_enabled=1` 的 key 从 DB 读取，TTL 2s 刷新，`invalidate()` 立即刷新。
- **选择**：Round Robin，跳过 冷却/不可用/超限(in-flight)。
- **冷却**：429 → 优先 `Retry-After`，否则指数退避 + jitter；`cooldown_until`。
- **不可用**：401/403 → `unavailable_until = now + 300s`，到期自动恢复。
- **并发**：每 key `VIDEO_MAX_IN_FLIGHT_PER_KEY` in-flight 上限；全局信号量 `VIDEO_MAX_CONCURRENCY`。
- **状态**：`pool_status()` 返回 available/cooldown/unavailable。
- **DB 层 `api_key_service`**：CRUD + `is_active` 语义 + 环境变量导入。

**安全缺口**：`api_keys.api_key` **明文存 SQLite**；状态全在进程内存，多 worker/多实例不一致。

---

## 6. 当前对象存储结构

统一抽象 `StorageProvider`（`base.py`），工厂 `get_storage_service()`，实现：`none` / `qiniu` / `s3`。

- **接口**：`upload_bytes` / `upload_from_url` / `get_display_url`。
- **Object Key 规范**（`build_object_key`）：
  `{prefix}/images|videos|documents|other/{yyyy}/{mm}/{dd}/{uuid}.{ext}`
- **S3**：boto3，走默认 Credential Chain（IAM Role），私有 bucket 用 presigned URL（TTL 1h），支持自定义 CDN base URL。
- **七牛**：包装 `qiniu_service`，`get_display_url` = `{domain}/{key}`。
- **落库存储**：`storage_provider` + `storage_key`（稳定对象 key），**不落 presigned URL** —— 这是好设计，新架构应保留。
- **容错**：转存失败降级保留 Agnes 原始 URL，不把 AI 结果判失败。

---

## 7. 当前前端调用后端的方式

- `frontend/next.config.mjs`：`rewrites()` 把 `/api/:path*` → `BACKEND_URL/api/:path*`（默认 `http://127.0.0.1:8000`）。
- 浏览器只访问 `/api/*`，不感知后端地址。
- `frontend/lib/api.ts`：手写类型化 client（`chatApi`/`imageApi`/`videoApi`/`settingsApi`/`systemApi`），统一 `fetch`，注入 `X-Request-ID`，流式处理 SSE（`postStream`）。
- 错误格式：`{detail, error_code, request_id}`（前端 `attachRequestMeta` 拼进错误消息）。

**现状**：无 OpenAPI 生成 SDK，client 手写；错误判断靠字符串 `detail`，未用稳定 `error_code` 做分支。

---

## 8. 可以复用的模块（迁移到新架构）

| 现有资产 | 复用方式 |
|---|---|
| `StorageProvider` 抽象 + S3/Qiniu/none | 平移为 `packages/provider` 下的 TS `ObjectStorage` 接口 + S3/Qiniu 实现 |
| Object key 规范 + presigned URL 逻辑 | 平移为 `packages/provider` 工具函数 |
| `error_utils.py` 稳定错误码 + 异常分类 | 平移为 `packages/contracts` 的 `ErrorCode` 枚举 + `DomainError` |
| Token Pool 的 冷却/退避/in-flight/不可用 概念 | 重设计为 `ProviderCredentialManager`（Redis 持久化） |
| 结构化日志 + request_id/task_id + 脱敏思路 | 平移为 NestJS Logger + request-id 中间件 + redact 工具 |
| `next.config.mjs` rewrite 思路 | 保留：Next.js rewrite `/api/v1/*` → API Server |
| 前端 UI 组件（ChatView/ImageView/VideoView/SettingsView） | 大部分保留，仅替换 API 调用层为 SDK + 加入鉴权 |
| 前端 `api.ts` 的 SSE 流式解析 | 复用其解析逻辑，改写为调用 SDK |

---

## 9. 应废弃或重写的模块

| 模块 | 处置 | 原因 |
|---|---|---|
| FastAPI routers（chat/images/videos/settings/system） | 重写为 NestJS Modules | 前后端统一 TS、独立 API 进程 |
| SQLite schema + `database.py` 手写迁移 | 废弃，换 Drizzle + PostgreSQL | 并发/事务/多实例；版本化迁移 |
| `image_tasks` / `video_tasks` 两套平行表 | 废弃，合并为 `GenerationJob` | 统一任务模型 |
| `api_keys` 明文 + `api_key_service` | 废弃，换加密 `ProviderCredential` | 安全要求 |
| `api_key_pool.py` 进程内状态 | 废弃，换 Redis 后端 Credential Manager | 多实例/Worker 可靠 |
| APScheduler + `video_poller.py` + background thread 转存 | 废弃，换 BullMQ Worker | 可靠任务队列、幂等、重启恢复 |
| `app_settings` 键值存储 | 拆分：Provider 表 + Admin Settings | 职责清晰 |
| `background_tasks.add_task` | 废弃，换 BullMQ enqueue | 不依赖进程内存 |
| 同步图片生成 | 重写为异步 Job | 统一异步原则 |

---

## 10. 目标目录结构（渐进迁移目标态）

```text
apps/
  web/               # Next.js（现有 frontend 迁入，/api/v1/* rewrite）
  api/               # NestJS + Fastify（REST /api/v1 + OpenAPI）
  worker/            # BullMQ Worker 进程（generation 消费）

packages/
  db/                # Drizzle schema + migrations + client
  contracts/         # 共享 DTO / enum / ErrorCode / 类型
  sdk/               # 由 OpenAPI 生成的 TS Client
  config/            # 共享 env/配置校验
  provider/          # AIProvider 抽象 + ObjectStorage + CredentialManager

docker-compose.yml   # postgres + redis + api + worker + web
```

**架构原则落地**：Monodular Monolith（不拆微服务）；web/api/worker 三个独立进程；所有新 API 从 `/api/v1` 开始；业务模块（auth/workspace/conversation/generation/billing/admin）通过 `packages/contracts` 共享类型，通过 NestJS Module 边界解耦。

---

## 11. 目标 PostgreSQL Schema（核心表）

> 详细迁移见下文「Phase 2~7」。核心建模：

- **Identity**：`users`(id, email, password_hash, status, role)、`sessions`(id, user_id, token_hash, expires_at)。
- **Workspace**：`workspaces`(id, name, type[PERSONAL|TEAM], owner_user_id)、`workspace_members`(workspace_id, user_id, role)。
- **Convo**：`conversations`(id, workspace_id, user_id, title)、`messages`(id, conversation_id, workspace_id, role, content, model, provider, input_tokens, output_tokens, metadata)。
- **Generation**：`generation_jobs`(id, workspace_id, user_id, type, status, provider, model, input_json, output_json, provider_job_id, estimated_credits, reserved_credits, actual_credits, estimated_cost_usd, actual_cost_usd, error_code, error_message, timestamps)。状态机 PENDING→QUEUED→RUNNING→SUCCEEDED/FAILED/CANCELED。
- **Asset**：`assets`(id, workspace_id, user_id, generation_job_id, type, storage_provider, bucket, object_key, mime_type, size, width, height, duration, metadata)。
- **Provider**：`providers`(id, code, name, base_url, status, config)、`provider_credentials`(id, provider_id, encrypted_secret, status, priority, weight, max_concurrency, current_concurrency, cooldown_until, last_used_at, last_error)。
- **Billing**：`wallets`(id, workspace_id, balance, reserved_balance)、`wallet_ledger`(id, workspace_id, type, amount, balance_before/after, reserved_before/after, generation_job_id, order_id, idempotency_key, description)、`pricing_rules`(id, generation_type, provider, model, credits, pricing_json, enabled)、`usage_events`(id, workspace_id, user_id, generation_job_id, provider, model, type, input_tokens, output_tokens, duration, resolution, provider_cost_usd, credits_charged, metadata)。
- **Admin**：`admin_audit_logs`(id, actor_user_id, action, resource_type, resource_id, before, after, ip, user_agent)。
- **Money**：`plans`、`subscriptions`（订阅预留）、`orders`（含 `amount_cents` CNY 充值）、`payment_transactions`（Phase 7 已实现充值闭环）。
- **历史迁移**：`legacy_users`、`legacy_workspace`（单租户历史数据归集）。

---

## 12. Phase 1 ~ Phase 7 迁移计划

| Phase | 目标 | 关键交付 | 验证 |
|---|---|---|---|
| **0 分析** | 现状盘点 | `CURRENT_ARCHITECTURE.md` | 本文档 |
| **1 基础设施** | Monorepo 立起来 | `apps/api` `apps/worker` `packages/db/contracts/sdk/config/provider`；NestJS+Fastify、Drizzle+PG、Redis、BullMQ、OpenAPI SDK | dev/build/lint/test |
| **2 Auth+Workspace** | 用户与隔离地基 | User/Workspace/Member/Session/Auth(register/login/logout/me)；注册事务建 Personal Workspace+Wallet+Welcome Credits | Auth 单测 |
| **3 Conversation** | 迁移对话 | Conversation/Message + workspace 隔离（IDOR 防护） | 隔离单测 |
| **4 Generation** | 统一生成 | GenerationJob/Asset/Provider/ProviderCredential/BullMQ Worker；先图片后视频 | Generation 单测 |
| **5 Billing** | 计费闭环 | Wallet/Ledger/Pricing/UsageEvent + Reserve/Settle/Release | **Billing 重点单测** |
| **6 Admin** | 运营后台 | `/api/v1/admin/*`（Provider/Credential/User/Stats/Audit）+ AdminGuard 角色鉴权 + `admin_audit_logs` 审计 | 鉴权/审计单测 ✅ |
| **7 支付** | 充值闭环（CNY） | `packages/payment`（Provider 抽象 + Registry + sandbox/alipay/wechat 适配层 + 换算纯函数）；`PaymentModule`：充值下单/回调验签幂等入账/sandbox 模拟端点；`WalletGateway.recharge`（RECHARGE + order_id + 幂等）；orders 增 `amount_cents` | payment 包 + API 单测 ✅ |

**迁移策略**：渐进式。新 `apps/api` + `apps/worker` 独立启动，NestJS 先承载 `/api/v1/*`；现有 FastAPI 在上线过渡期继续服务旧 `/api/*`（由 Next.js rewrite 指向新 API 的 `/api/v1/*`，旧路径逐步迁移）。SQLite 历史数据用一次性脚本导入 PG（见下）。

---

## 13. 最大的 10 个迁移风险

1. **历史数据迁移完整性**：SQLite 的 `image_tasks`/`video_tasks`/`conversations`/`messages`/`uploads` 需映射到 `GenerationJob`/`Asset`/`Conversation`/`Message`，字段语义不完全一致（如 status 枚举、`qiniu_url` vs `object_key`），需一次性脚本 + 校验/可重复执行防重。
2. **Reserve/Settle 并发正确性**：Wallet 余额/预留的事务与锁是计费核心，需防并发超卖、负余额、Worker 重试重复 settle；这是最容易出错处，必须用明确行锁 + 幂等键 + 单测覆盖。
3. **Provider Secret 加密迁移**：现 `api_keys` 明文，需一次性用 AES-GCM 重新加密进入 `provider_credentials`，且 Master Key 管理、API/日志零泄露。
4. **SSRF 治理**：现 Base URL 可被普通用户通过设置页修改，新架构必须管理员限定 + 协议/地址校验 + 内网 IP 黑名单。
5. **进程内状态到 Redis/队列的迁移**：`api_key_pool` 内存态、APScheduler 轮询、BackgroundTasks 提交，全部要改为 Redis 持久化 + BullMQ，Worker crash/重启可恢复，开发量不小。
6. **同步图片生成改异步**：前端 UI 从「等结果」改「轮询/订阅」，交互与体验需同步调整，容易在过渡期出现回归。
7. **前后端类型一致性**：不把 ORM 实体直接当 DTO，需维护 `packages/contracts` + OpenAPI 生成 SDK，契约变更需同步，避免类型漂移。
8. **货币精度**：Credits/USD 不能用浮点，需整数分/定点数约定贯穿 Wallet/Ledger/Pricing/Usage，避免精度裂缝。
9. **多进程身份与会话**：HttpOnly Cookie 会话需在 API 独立进程下正确签发/校验，与 Next.js SSR 的代理、CSRF、SameSite 配置需谨慎。
10. **部署与回滚复杂度**：从「两容器」变「PG+Redis+api+worker+web」多服务，现有 `update.sh`/`rollback.sh`/`docker-compose.prod.yml`/CI 都要适配新拓扑，且需保证旧数据不丢。

---

## 附：ORM 选型分析（Prisma vs Drizzle）

**结论：选择 Drizzle。**

- **SQL-first / TS-first**：本项目计费核心（Reserve/Settle/Release、WalletLedger 幂等、防超卖）需要精细的数据库事务与少量原生 SQL；Drizzle 允许接近 SQL 的表达，事务边界清晰，易写 `SELECT ... FOR UPDATE` 行锁。
- **官方 NestJS 集成**：`drizzle-orm/nestjs`（`@drizzle-orm/nestjs`）是一等模块，配合 `@nestjs/drizzle` 生命周期管理，与 NestJS 模块化天然契合。
- **轻量、无代码生成二进制**：Drizzle 是纯 TS，无 Prisma 的 Rust Query Engine 二进制；在 Worker 镜像和快速迭代时更省心，也利于 Modular Monolith 内共享 schema。
- **迁移**：`drizzle-kit` 提供 SQL/TS 迁移，可重复执行、可防重复，满足「Migration 可重复或防重复」要求。
- **Money 精度**：Drizzle 配合 `numeric`/`bigint` 类型映射比 Prisma 的 Decimal 更直观可控。

> 仅当团队更看重 Prisma 的 Studio/DX 生态时才考虑 Prisma；本项目以「事务控制 + SQL 表达 + NestJS 整合」为优先，故选 **Drizzle**，且全程只用一个 ORM。