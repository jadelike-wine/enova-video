# EnovaMotion 产品事实参考

> 本文档是 Codex/Agent 了解 EnovaMotion（灵动创影）产品的稳定入口。内容按当前新架构仓库核对，记录“现在是什么”和“当前代码支持什么”，不替代具体需求的 PRD。

**核对时间：** 2026-08-13  
**产品名称：** 灵动创影（EnovaMotion）  
**产品类型：** 面向 AI 创作者的多模态创作 SaaS  
**当前核心产出：** AI 图片与 AI 视频  
**实现形态：** Next.js Web + NestJS API + BullMQ Worker 的模块化单体

## 1. 一句话定位

灵动创影把文本对话、图片生成和视频生成放在同一个 Web 工作区中，用户以 Credits 作为统一使用额度，生成结果保存在任务历史和媒体资产中；管理员负责 Provider、凭证、价格、支付、用户和系统运维。

产品对外品牌使用“灵动创影 / EnovaMotion”。底层 Provider、模型 API ID 和凭证属于平台实现细节，不应在普通用户界面或产品文案中直接暴露。

## 2. 产品目标与主要场景

### 目标用户

| 用户 | 目标 | 主要入口 |
| --- | --- | --- |
| 普通创作者 | 用自然语言或参考图快速生成图片、短视频，并查看历史结果 | `/app/chat`、`/app/images`、`/app/videos` |
| 工作区成员 | 在被授权的 Workspace 内使用会话、生成任务和 Credits | Workspace-scoped API 与应用页面 |
| 管理员/运营人员 | 管理用户、Provider、凭证、价格、订单、系统设置和运行状态 | `/app/admin/*` |

### 核心使用场景

1. 用户注册或登录后进入个人 Workspace。
2. 用户在对话页进行文本交互，或直接进入图片/视频创作页。
3. 用户提交生成参数；平台校验权限和余额，估算并预留 Credits，然后异步执行任务。
4. Worker 调用已配置 Provider，必要时轮询视频任务，下载结果并写入媒体资产。
5. 成功任务结算实际 Credits；失败或取消任务释放预留 Credits。
6. 用户在页面中查看任务状态、预览结果、查看余额与流水，必要时充值。

## 3. 用户可见能力

### 3.1 账户、会话与工作区

- 邮箱和密码注册、登录、登出。
- 可由管理员配置登录/注册条款；启用后后端校验条款 revision，并记录用户同意的版本、时间、IP 与 User-Agent。
- 公开法律文档页可通过条款文档 slug 访问，Markdown 内容经过前端安全渲染。
- HttpOnly Session Cookie 鉴权；支持查看会话、撤销单个会话、撤销其他会话和修改密码。
- 可选 Turnstile 人机校验。
- 用户默认进入 Personal Workspace；数据访问按 Workspace 隔离。
- Workspace 成员角色包括 `OWNER`、`ADMIN`、`MEMBER`；登录身份角色包括 `USER`、`ADMIN`。
- 首次部署可通过 `/setup` 创建首个管理员账号。

实现依据：[`apps/api/src/auth`](../apps/api/src/auth)、[`apps/api/src/setup`](../apps/api/src/setup)、[`packages/db/src/schema.ts`](../packages/db/src/schema.ts)、[`apps/web/app/auth`](../apps/web/app/auth)。

### 3.2 文本对话

- 支持创建、重命名、删除会话。
- 支持查看会话消息并以流式方式发送消息。
- 会话、消息和模型信息按 Workspace 归属保存。
- 当前产品首页和主宣传语聚焦图片/视频创作；对话页仍是应用内可用能力，不能因为首页未突出就当作已删除。

实现依据：[`apps/web/app/app/chat`](../apps/web/app/app/chat)、[`apps/web/components/application/ChatView.tsx`](../apps/web/components/application/ChatView.tsx)、[`apps/api/src/conversations`](../apps/api/src/conversations)、[`packages/provider/src/ai-provider.interface.ts`](../packages/provider/src/ai-provider.interface.ts)。

### 3.3 图片生成

当前前端提供：

- 文生图（`text2img`）。
- 单图编辑/图生图（`img2img`）。
- 多图合成（`multi_img`）。
- 多种尺寸：`1024x1024`、`1024x768`、`768x1024`、`1280x720`、`720x1280`。
- 生成任务历史、状态展示和生成结果预览。

当前前端模型目录包含“高清图片生成”和“标准图片生成”两个用户可见名称；底层 API ID 集中维护在 `apps/web/lib/models.ts`，新增模型时要同步考虑产品文案与 Provider 能力。

实现依据：[`apps/web/app/app/images/page.tsx`](../apps/web/app/app/images/page.tsx)、[`apps/web/components/application/ImageView.tsx`](../apps/web/components/application/ImageView.tsx)、[`apps/web/lib/models.ts`](../apps/web/lib/models.ts)。

### 3.4 视频生成

当前前端提供：

- 文生视频（`text2video`）。
- 图生视频（`img2video`）。
- 多图视频（`multi_img`）。
- 关键帧动画（`keyframes`）。
- 时长预设：4 秒、5 秒、8 秒。
- 分辨率预设：720p/1080p 横屏与竖屏。
- 内置播放器、任务状态展示和异步进度等待。

视频生成是异步任务：API 创建并入队，Worker 提交 Provider 任务，随后使用延迟轮询直到成功、失败、取消或达到轮询上限。

实现依据：[`apps/web/app/app/videos/page.tsx`](../apps/web/app/app/videos/page.tsx)、[`apps/web/components/application/VideoView.tsx`](../apps/web/components/application/VideoView.tsx)、[`apps/web/lib/models.ts`](../apps/web/lib/models.ts)、[`apps/worker/src/generation/pipeline.ts`](../apps/worker/src/generation/pipeline.ts)。

### 3.5 Credits、钱包与充值

- 每个 Workspace 有一个钱包，包含可用余额和预留余额。
- 注册时可发放 Welcome Credits，具体额度由配置决定。
- 创建生成任务时使用 `Reserve` 预留额度。
- 任务成功时使用 `Settle` 按实际消耗结算；失败或取消时使用 `Release` 释放预留额度。
- 钱包流水保留余额前后值、流水类型、关联任务/订单和幂等键。
- 支持沙箱支付；支付宝和微信支付适配器在配置商户凭证后可作为真实渠道。
- 充值订单的支付状态和履约状态独立记录，回调处理必须幂等。

实现依据：[`apps/web/app/app/wallet/page.tsx`](../apps/web/app/app/wallet/page.tsx)、[`apps/api/src/billing`](../apps/api/src/billing)、[`apps/api/src/payment`](../apps/api/src/payment)、[`packages/billing/src`](../packages/billing/src)、[`packages/payment/src`](../packages/payment/src)、[`packages/db/src/schema.ts`](../packages/db/src/schema.ts)。

### 3.6 历史资产与存储

- 图片、视频和用户上传内容统一建模为 Asset。
- Asset 关联 Workspace、用户和生成任务，可记录 MIME 类型、大小、尺寸、时长和对象 key。
- Worker 会对 Provider 返回的媒体 URL 做 SSRF 校验、超时/大小/content-type 限制，然后按配置转存。
- 当前对象存储工厂支持 `aws_s3`、`qiniu` 和 `none` 分支。Provider、凭证和日志/计费运行参数由管理员后台「系统设置」动态管理；数据库没有配置时才回退到环境变量，存储配置不完整时进程保持可运行并暂时使用 `none`。

实现依据：[`packages/db/src/schema.ts`](../packages/db/src/schema.ts)、[`packages/provider/src/storage`](../packages/provider/src/storage)、[`packages/provider/src/url-guard.ts`](../packages/provider/src/url-guard.ts)、[`apps/worker/src/generation/pipeline.ts`](../apps/worker/src/generation/pipeline.ts)。

### 3.7 管理后台

管理员页面覆盖：

- Dashboard、用户、客户 360、生成任务和订单。
- Provider 与 Provider Credential 管理。
- 价格规则、价格版本和报价预览。
- 系统设置、审计日志、统计分析和运行监控。
- RBAC 角色/权限管理。
- 邮件测试、系统更新和回滚入口。

管理后台属于运营与工程能力，不应混入普通创作用户的产品流程。所有管理员写操作都应继续遵守权限检查、审计和敏感操作保护。

实现依据：[`apps/web/app/app/admin`](../apps/web/app/app/admin)、[`apps/web/components/application/admin`](../apps/web/components/application/admin)、[`apps/api/src/admin`](../apps/api/src/admin)。

## 4. 核心领域模型

```text
User
 └─ WorkspaceMember ── Workspace
                         ├─ Conversation ── Message
                         ├─ Wallet ── WalletLedger
                         ├─ Order
                         ├─ GenerationJob ── Asset
                         └─ Workspace-scoped access boundary

Provider ── ProviderCredential
GenerationJob ── PricingRule / PriceQuote ── Worker attempt
```

| 概念 | 产品含义 | 关键边界 |
| --- | --- | --- |
| User | 登录身份和账户 | 不等于 Workspace；用户可通过成员关系进入工作区 |
| Workspace | 资源与计费隔离单元 | 会话、任务、资产、钱包和订单必须带 Workspace 归属 |
| Conversation | 文本对话容器 | 消息只能在所属 Workspace 内访问 |
| GenerationJob | 图片/视频统一任务 | 状态、输入、输出、额度和错误均以任务为中心 |
| Asset | 可预览/下载的图片、视频或上传文件 | 关联任务但允许任务被删除后保留引用关系为空 |
| Wallet | Workspace 的 Credits 账户 | 可用余额与预留余额分开，避免并发超卖 |
| WalletLedger | 不可变余额变化记录 | 每笔变化必须可审计且带幂等键 |
| Order | 充值、套餐或 Credit Pack 订单 | 支付状态与履约状态分离 |
| Provider | 上游 AI 服务配置 | Base URL 必须经过 SSRF 校验 |
| ProviderCredential | Provider 的加密凭证 | Secret 只保存加密值，Worker 通过租约控制并发 |

## 5. 关键状态与业务不变量

### 5.1 GenerationJob 状态

```text
PENDING → QUEUED → RUNNING → SUCCEEDED
                         ├──→ FAILED
                         └──→ CANCELED
```

- API 创建任务时完成定价、额度预留和队列投递。
- Worker 负责实际 Provider 调用、视频轮询、结果下载/转存和最终结算。
- 同一任务的重复队列事件、重试和回调不能重复创建资产、结算或释放额度。
- 最终失败必须把任务标记为 `FAILED`，并幂等释放预留 Credits。
- 用户取消任务必须释放额度；运行中的视频任务由 Worker 负责通知上游取消或完成清理。

实现依据：[`apps/api/src/generations/generations.service.ts`](../apps/api/src/generations/generations.service.ts)、[`apps/api/src/generations/outbox.dispatcher.ts`](../apps/api/src/generations/outbox.dispatcher.ts)、[`apps/worker/src/generation/state.ts`](../apps/worker/src/generation/state.ts)、[`apps/worker/src/generation/pipeline.ts`](../apps/worker/src/generation/pipeline.ts)。

### 5.2 计费状态

```text
创建任务 → 估价 → Reserve
                    ├─ 成功 → Settle
                    ├─ 失败 → Release
                    └─ 取消 → Release
```

计费金额使用整数单位：Credits 为整数；供应商成本使用微美元整数；支付金额使用分。不要在新业务逻辑中引入浮点金额计算。

### 5.3 访问与安全边界

- API 资源查询必须同时带资源 ID 和当前 Workspace ID，防止 IDOR。
- Provider Base URL 和远程媒体 URL 必须经过 SSRF guard。
- 远程下载必须保留超时、大小上限和允许的 content type。
- Provider Secret、支付凭证、Session Secret、用户 prompt 等敏感内容不能进入日志、快照或客户端 bundle。
- Provider Credential 的并发控制必须使用 Redis 等跨 Worker 一致性边界，不能退化为进程内 Map。

## 6. 功能矩阵与实现状态

| 能力 | 用户/运营入口 | 状态 | 说明 |
| --- | --- | --- | --- |
| 注册/登录/会话 | `/auth/*`、设置页 | 已实现 | HttpOnly Cookie；含会话管理和密码流程 |
| 登录条款与公开法律文档 | `/auth/*`、`/legal/[slug]`、管理员系统配置 | 已实现 | 后端强制校验当前 revision；按用户记录同意历史；条款关闭时不影响原有登录流程 |
| Personal Workspace | 登录初始化 | 已实现 | 注册后自动创建并隔离资源 |
| 文本对话 | `/app/chat` | 已实现 | 会话、消息、流式发送和历史管理 |
| 图片生成 | `/app/images` | 已实现 | 文生图、单图编辑、多图合成 |
| 视频生成 | `/app/videos` | 已实现 | 文/图生视频、多图视频、关键帧、异步轮询 |
| GenerationJob 历史 | 图片/视频页、API | 已实现 | 统一状态机和取消接口 |
| Credits 钱包/流水 | `/app/wallet` | 已实现 | Reserve/Settle/Release 和幂等账本 |
| 沙箱充值 | 钱包页/API | 已实现 | 本地演示和测试用，不代表真实支付已配置 |
| 支付宝/微信 | 支付适配器/API | 已实现适配器 | 需要服务端商户配置后才可用 |
| Asset 持久化 | 生成结果 | 已实现 | `none` 或 S3/S3-compatible 存储分支 |
| Provider/凭证后台 | 管理后台 | 已实现 | 凭证加密、状态和租约机制 |
| 价格/报价后台 | 管理后台 | 已实现 | 规则、版本、发布和报价预览 |
| 用户/订单/统计/审计 | 管理后台 | 已实现 | 受管理员权限和审计约束 |
| 音频、放大、口型同步、视频转视频 | Schema/共享枚举 | 预留/未开放 | 不能因为枚举存在就当作当前产品能力 |
| 团队协作 UI | Workspace schema | 部分基础能力 | 成员模型和隔离已存在；不要假定完整邀请/协作体验已交付 |

## 7. Provider 与模型产品边界

- 当前产品默认围绕 Agnes Provider 集成；ProviderRegistry 和 `AIProvider` 接口为扩展其他上游服务提供边界。
- 图片和视频的用户可见名称由前端模型目录维护，底层 API ID 属于实现配置。
- 新增模型必须同时核对：用户文案、输入模式、尺寸/时长限制、价格规则、Provider mapper、任务/计费测试和管理后台配置。
- 不要在普通用户 UI 中展示 API Key、Base URL、原始 Provider Secret 或未产品化的内部错误详情。

实现依据：[`packages/provider/src/ai-provider.interface.ts`](../packages/provider/src/ai-provider.interface.ts)、[`packages/provider/src/provider-registry.ts`](../packages/provider/src/provider-registry.ts)、[`packages/provider/src/agnes`](../packages/provider/src/agnes)、[`apps/web/lib/models.ts`](../apps/web/lib/models.ts)。

## 8. 当前架构映射

```text
Browser
  ↓
Web / Next.js（apps/web）
  ↓ same-origin /api/v1 rewrite
API / NestJS + Fastify（apps/api）
  ├─ PostgreSQL / Drizzle（packages/db）
  ├─ Redis + BullMQ（队列与跨 Worker 协调）
  └─ packages/billing + packages/payment + packages/provider
       ↓
Worker（apps/worker）
  ├─ 调用 Provider
  ├─ 视频任务轮询
  ├─ 结果下载与对象存储
  └─ GenerationJob 最终结算/释放
```

| 目录 | 产品职责 |
| --- | --- |
| `apps/web` | 用户创作、钱包、设置和管理员页面 |
| `apps/api` | 鉴权、会话、对话、生成任务、计费、支付和后台 API |
| `apps/worker` | 异步生成执行、轮询、媒体处理和最终计费状态 |
| `packages/contracts` | API/Worker/SDK 共用的状态、错误码、队列 payload |
| `packages/db` | PostgreSQL schema、Drizzle client 和 migration |
| `packages/provider` | Provider 抽象、Agnes、凭证加密/租约、SSRF、对象存储 |
| `packages/billing` | 钱包、Credits、价格和计费领域逻辑 |
| `packages/payment` | 沙箱、支付宝、微信支付适配层 |
| `packages/sdk` | 从 API OpenAPI 文档生成的客户端类型和请求封装 |
| `packages/migrator` | 旧 SQLite 数据迁移辅助逻辑 |

## 9. Agent 修改产品能力时的检查清单

1. 先判断需求属于用户创作、计费、Provider、后台还是基础设施。
2. 用户可见能力优先更新 `apps/web`，领域逻辑优先放对应 `packages/*`。
3. 涉及 GenerationJob、Credits、支付、凭证、Workspace 隔离时，先检查本文件的状态机和不变量。
4. 修改队列 payload 时同步检查 API、Worker、`packages/contracts`、测试和兼容逻辑。
5. 修改数据库 schema 时必须生成 Drizzle migration。
6. 修改 API 后重新生成 `apps/api/openapi.json`，再生成 SDK；不要手工改生成文件。
7. 涉及产品文案、模型、页面或价格时同步更新本文件的功能矩阵，明确“已实现/预留/部分实现”。
8. 变更完成后按 [AGENTS.md](../AGENTS.md) 要求执行相关 lint、typecheck、test 和 build，并报告未执行项。

## 10. 已知文档边界

- 本文档不承诺具体模型的可用性、价格或上游 SLA；这些由运行时 Provider 配置和价格规则决定。
- 本文档不包含任何真实环境配置、密钥、支付参数或生产部署操作。
- 本文档基于当前新 monorepo；旧 `backend`（FastAPI + SQLite）和旧 `frontend` 不再是实现目标。
- 如果代码与本文档发生差异，应优先修正文档或代码中的事实来源，并在变更说明中明确差异，而不是默默扩大产品承诺。
