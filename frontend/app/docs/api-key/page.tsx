import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetadata } from '../../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: 'API Key',
  description: 'Agnes AI Creator 的 API Key 配置指南：如何获取并启用 Agnes AI API Key。',
  path: '/docs/api-key',
})

export default function ApiKeyPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold">配置 API Key</h1>
        <p className="text-white/60 mt-2">
          使用对话、图片与视频生成功能前，需要先配置并启用一个 Agnes AI API Key。
        </p>
      </header>

      <section>
        <h2 className="text-xl font-bold mb-3">1. 获取 API Key</h2>
        <ol className="space-y-2 list-decimal list-inside text-white/70">
          <li>
            前往{' '}
            <a href="https://platform.agnes-ai.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
              Agnes AI 平台
            </a>{' '}
            注册账号。
          </li>
          <li>在平台中创建 API Key。</li>
          <li>复制生成的 Key，妥善保存。</li>
        </ol>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">2. 在应用中添加</h2>
        <p className="text-white/70 mb-3">
          打开应用，进入{' '}
          <Link href="/app/settings" className="text-cyan-300 hover:underline">设置</Link>{' '}
          页面，在「添加 API Key」中填写名称与 Key，勾选「添加后立即启用」并保存。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">3. 验证</h2>
        <p className="text-white/70">
          设置页顶部会显示是否已启用 API Key 的状态。启用后即可在对话、图片与视频页面正常使用。
        </p>
      </section>
    </div>
  )
}