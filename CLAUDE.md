# CLAUDE.md

## 工作上下文

这是 EnovaMotion（灵动创影）项目。仓库为**单一新架构（monorepo）**：`apps/api` + `apps/worker` + `apps/web` + `packages/*`，使用 pnpm、TypeScript、NestJS/Fastify、Drizzle/PostgreSQL、Redis/BullMQ 和 Next.js。旧架构的 `backend`（FastAPI + SQLite）与 `frontend` 目录已删除，不再存在。

新业务优先实现到新 monorepo；所有功能修复与新增能力均在新架构内完成，无需区分新旧。

## 快速命令

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm sdk:generate
```

新 API 默认监听 `3001`，新 web 默认监听 `3000`；本地基础设施是 PostgreSQL `5432` 和 Redis `6379`。环境变量模板是根目录 `.env.example`，不要提交 `.env` 或任何真实凭证。

## 编码规则

- 新 TypeScript 代码使用 ESM 相对导入并保留 `.js` 后缀。
- 共享类型、错误码和队列 payload 放在 `packages/contracts`；共享领域能力放在对应 `packages/*`，不要复制到 API/worker。
- API 输入使用 DTO 和现有全局 `ValidationPipe`；保持 Nest module/controller/service 分层。
- schema 改动必须生成并提交 Drizzle migration；API 改动后重新生成 `apps/api/openapi.json` 和 SDK 类型。
- 不破坏 Redis 跨 worker 的凭证租约、SSRF guard、远程请求超时/下载大小限制，以及 generation 失败后的幂等退款。
- 不把 API key、session/provider secret、用户 prompt 或支付凭证写进日志、客户端 bundle 或 `NEXT_PUBLIC_*`。
- UI 改动统一在 `apps/web`。
- 避免无关重构和全仓格式化；不要提交 `dist`、`.next`、`node_modules`、`.venv`、数据库文件、备份或 `.env`。

## 完成标准

修改后按范围运行相关的 lint、typecheck、test 和 build；跨 workspace 或数据库/OpenAPI 变更优先运行全部 pnpm 校验。最终说明实际运行的命令和结果，并明确任何未执行的验证。除非用户要求，不执行生产部署、数据库回滚、删除数据或其他不可逆操作。

更完整的目录职责、迁移边界和安全不变量见 [AGENTS.md](./AGENTS.md)。
