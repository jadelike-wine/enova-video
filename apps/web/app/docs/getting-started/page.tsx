import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetadata, siteUrl } from '../../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: '快速开始',
  description: '灵动创影快速入门指南：了解项目架构、本地部署与开发方式。',
  path: '/docs/getting-started',
})

export default function GettingStartedPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold">快速开始</h1>
        <p className="text-white/60 mt-2">
          灵动创影是一个基于 Node.js 的 Modular Monolith：Next.js 前端（apps/web）+ NestJS API（apps/api）+ BullMQ Worker（apps/worker），
          使用 PostgreSQL + Redis 存储。本文介绍如何在本地运行。
        </p>
      </header>

      <section>
        <h2 className="text-xl font-bold mb-3">项目架构</h2>
        <div className="glass p-5 rounded-3xl font-mono text-sm text-white/80 leading-relaxed">
          <div>Browser</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;v</div>
          <div>&nbsp;&nbsp;&nbsp;Web (Next.js :3000)</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;| &nbsp;/api/v1/*</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;v</div>
          <div>&nbsp;&nbsp;&nbsp;API (NestJS :3001)</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+-- PostgreSQL / Redis</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;v</div>
          <div>&nbsp;&nbsp;&nbsp;Worker (BullMQ)</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;| 调用 Agnes → 轮询 → 转存 → 结算</div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">启动基础设施</h2>
        <pre className="glass p-4 rounded-2xl overflow-x-auto text-sm text-cyan-200 font-mono">
{`cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL + Redis`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">启动 API 与 Worker</h2>
        <pre className="glass p-4 rounded-2xl overflow-x-auto text-sm text-cyan-200 font-mono">
{`pnpm install
pnpm dev:api       # NestJS API，默认 :3001
pnpm dev:worker    # BullMQ 生成任务消费者`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">启动前端</h2>
        <pre className="glass p-4 rounded-2xl overflow-x-auto text-sm text-cyan-200 font-mono">
{`pnpm --filter @enova/web dev`}
        </pre>
        <p className="text-white/60 text-sm mt-3">
          打开 <Link href="/" className="text-cyan-300 hover:underline">{siteUrl()}</Link>。
          前端通过 <code className="text-cyan-300">/api/v1/*</code> 转发到 NestJS API（默认 <code className="text-cyan-300">http://localhost:3001</code>）。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">下一步</h2>
        <ul className="space-y-2">
          <li><Link href="/docs/api-key" className="text-cyan-300 hover:underline">配置 API Key</Link> 以启用 AI 功能。</li>
          <li><Link href="/docs/image-generation" className="text-cyan-300 hover:underline">图片生成</Link> 使用指南。</li>
          <li><Link href="/docs/video-generation" className="text-cyan-300 hover:underline">视频生成</Link> 使用指南。</li>
        </ul>
      </section>
    </div>
  )
}