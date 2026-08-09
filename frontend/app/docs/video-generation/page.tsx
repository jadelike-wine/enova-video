import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetadata } from '../../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: '视频生成',
  description: 'Agnes AI Creator 视频生成功能使用指南：文生视频、图生视频、多图视频与关键帧动画。',
  path: '/docs/video-generation',
})

export default function VideoGenerationPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold">视频生成</h1>
        <p className="text-white/60 mt-2">
          Agnes AI Creator 支持文生视频、图生视频、多图视频与关键帧动画四种视频生成模式。
        </p>
      </header>

      <section>
        <h2 className="text-xl font-bold mb-3">支持的模型</h2>
        <p className="text-white/70">
          使用 <Link href="/models/agnes-video-v2-0" className="text-cyan-300 hover:underline">Agnes Video V2.0</Link>。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">生成模式</h2>
        <ul className="space-y-2 text-white/70">
          <li><strong className="text-white">文生视频</strong>：仅输入提示词即可生成。</li>
          <li><strong className="text-white">图生视频</strong>：上传一张起始图。</li>
          <li><strong className="text-white">多图视频</strong>：上传多张图片生成动画。</li>
          <li><strong className="text-white">关键帧动画</strong>：通过关键帧控制画面。</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">注意事项</h2>
        <p className="text-white/70">
          涉及参考图上传的模式依赖后端七牛云对象存储配置。视频为异步任务，生成需要数分钟，可在任务列表中查看进度。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">开始使用</h2>
        <Link href="/app/videos" className="btn-primary">进入视频生成</Link>
      </section>
    </div>
  )
}