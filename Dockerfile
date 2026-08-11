# syntax=docker/dockerfile:1
# =============================================================================
# 新架构（Monorepo）统一 Dockerfile。
#
# 一个仓库根级 Dockerfile，通过 --target 构建三个镜像：
#   docker build --target api     -t <img>-api:      # NestJS API
#   docker build --target worker  -t <img>-worker:   # BullMQ Worker
#   docker build --target web     -t <img>-web:      # Next.js 前端
#
# 构建上下文 = 仓库根（COPY node_modules 等 autoclean 见 .dockerignore）。
# 依赖 pnpm workspace，@enova/* 通过符号链接在 node_modules 中解析。
# =============================================================================

ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown

#############################
# 阶段 0: 基础（pnpm 运行时）
#############################
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
# 启用 corepack 以锁定 pnpm 版本（与 packageManager 一致）
RUN corepack enable
WORKDIR /app

#############################
# 阶段 1: 安装全部依赖（含 workspace 符号链接）
#############################
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
# 先复制各子包 package.json，避免依赖变更时全量重新 resolve
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/provider/package.json packages/provider/package.json
COPY packages/billing/package.json packages/billing/package.json
COPY packages/payment/package.json packages/payment/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/migrator/package.json packages/migrator/package.json
RUN pnpm install --frozen-lockfile --prod=false

#############################
# 阶段 2: 公共构建（仅编译 workspace 包）
#############################
FROM deps AS build-common
ENV NODE_ENV=production
COPY . .
# 先构建全部 workspace 包（顺序由 pnpm 依赖图决定）
RUN pnpm --filter './packages/*' build

#############################
# 阶段 3: 按应用独立构建
#############################
FROM build-common AS build-api
RUN pnpm --filter @enova/api build

FROM build-common AS build-worker
RUN pnpm --filter @enova/worker build

FROM build-common AS build-web
# 仅 Web 构建依赖这些公开配置，避免它们使 API / Worker 的缓存失效。
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG BACKEND_URL=http://localhost:3001
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    BACKEND_URL=${BACKEND_URL}
RUN pnpm --filter @enova/web build

#############################
# 阶段 4: API 运行时
#############################
FROM base AS api
ARG APP_VERSION
ARG GIT_SHA
ARG BUILD_TIME
LABEL org.opencontainers.image.title="enova-video-api" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"
ENV NODE_ENV=production
# 复制依赖（含 workspace 符号链接）与 workspace 包产物。
# pnpm 下应用私有依赖（如 reflect-metadata）以符号链接存在于 apps/api/node_modules，
# 必须一并复制，否则运行时解析不到。
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build-api /app/packages ./packages
COPY --from=build-api /app/apps/api/dist ./apps/api/dist
COPY --from=build-api /app/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
EXPOSE 3001
# 傻瓜化：容器启动前先执行 Drizzle 迁移（幂等，失败即退出 -> 健康检查失败 -> 自动回滚）。
# 迁移文件夹默认位于 /app/packages/db/drizzle（已随 packages 复制）。
CMD ["sh", "-c", "node /app/packages/db/dist/migrate.js \"$DATABASE_URL\" && exec node dist/main.js"]

#############################
# 阶段 5: Worker 运行时
#############################
FROM base AS worker
ARG APP_VERSION
ARG GIT_SHA
ARG BUILD_TIME
LABEL org.opencontainers.image.title="enova-video-worker" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"
ENV NODE_ENV=production
COPY --from=build-worker /app/node_modules ./node_modules
COPY --from=build-worker /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build-worker /app/packages ./packages
COPY --from=build-worker /app/apps/worker/dist ./apps/worker/dist
COPY --from=build-worker /app/apps/worker/package.json ./apps/worker/package.json
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

#############################
# 阶段 6: Web（Next.js standalone）运行时
#############################
FROM base AS web
ARG APP_VERSION
ARG GIT_SHA
ARG BUILD_TIME
LABEL org.opencontainers.image.title="enova-video-web" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"
ENV NODE_ENV=production
# standalone 模式：私有依赖已内联
COPY --from=build-web --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
WORKDIR /app/apps/web
USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
