import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetadata } from '../../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: '快速开始',
  description: 'Agnes AI Creator 快速入门指南：了解项目架构、本地部署与开发方式。',
  path: '/docs/getting-started',
})

export default function GettingStartedPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold">快速开始</h1>
        <p className="text-white/60 mt-2">
          Agnes AI Creator 由 Next.js 前端与 FastAPI 后端组成，后端使用 SQLite 存储。本文介绍如何在本地运行。
        </p>
      </header>

      <section>
        <h2 className="text-xl font-bold mb-3">项目架构</h2>
        <div className="glass p-5 rounded-3xl font-mono text-sm text-white/80 leading-relaxed">
          <div>Public Website / SEO Pages</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+</div>
          <div>Application UI</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;v</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Next.js</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;| &nbsp;/api/*</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;v</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;FastAPI</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;v</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;SQLite</div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">启动后端</h2>
        <pre className="glass p-4 rounded-2xl overflow-x-auto text-sm text-cyan-200 font-mono">
{`cd backend
pip install -r requirements.txt
cp .env.example .env   # 可选：配置七牛云等
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">启动前端</h2>
        <pre className="glass p-4 rounded-2xl overflow-x-auto text-sm text-cyan-200 font-mono">
{`cd frontend
npm install
npm run dev`}
        </pre>
        <p className="text-white/60 text-sm mt-3">
          打开 <Link href="/" className="text-cyan-300 hover:underline">http://localhost:3000</Link>。
          前端通过 <code className="text-cyan-300">/api/*</code> 转发到 FastAPI（默认 <code className="text-cyan-300">http://127.0.0.1:8000</code>）。
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