# syntax=docker/dockerfile:1

# 版本 / 构建信息（GitHub Actions 构建时注入；本地构建使用占位值）
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown

#############################
# 阶段 1: 安装生产依赖
#############################
FROM node:22-alpine AS deps
WORKDIR /app

# 仓库使用 npm（存在 package-lock.json），用 lockfile 保证依赖可复现
COPY package.json package-lock.json ./
RUN npm ci

#############################
# 阶段 2: 生产构建
#############################
FROM node:22-alpine AS builder
WORKDIR /app

# BACKEND_URL 在 next.config.mjs 中用于 /api/* rewrite，构建期生效
# NEXT_PUBLIC_SITE_URL 会在构建期内联进客户端 bundle（站点对外公开 URL，非密钥）
ARG BACKEND_URL=http://backend:8000
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV BACKEND_URL=${BACKEND_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

#############################
# 阶段 3: 运行（最小化 standalone 镜像）
#############################
FROM node:22-alpine AS runner
WORKDIR /app

# 继承根级 ARG 用于 Label
ARG APP_VERSION
ARG GIT_SHA
ARG BUILD_TIME
ENV NODE_ENV=production

# 非 root 运行
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# 镜像溯源 Label（version / git sha / build time）
LABEL org.opencontainers.image.title="enova-video-frontend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"

# standalone 模式：私有依赖已内联，无需 node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000 \
    HOSTNAME=0.0.0.0

CMD ["node", "server.js"]