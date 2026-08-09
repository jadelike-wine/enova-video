import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetadata } from '../../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: '图片生成',
  description: 'Agnes AI Creator 图片生成功能使用指南：文生图、单图编辑与多图合成。',
  path: '/docs/image-generation',
})

export default function ImageGenerationPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold">图片生成</h1>
        <p className="text-white/60 mt-2">
          Agnes AI Creator 提供文生图、单图编辑与多图合成三种图片生成模式。
        </p>
      </header>

      <section>
        <h2 className="text-xl font-bold mb-3">支持的模型</h2>
        <p className="text-white/70">
          使用 <Link href="/models/agnes-image-2-1-flash" className="text-cyan-300 hover:underline">Agnes Image 2.1 Flash</Link>。可在应用内切换模型。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">文生图</h2>
        <p className="text-white/70">选择「文生图」，输入提示词与尺寸，点击开始生成即可。</p>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">单图编辑 / 多图合成</h2>
        <p className="text-white/70">
          这两种模式需要上传参考图片，上传功能依赖后端七牛云对象存储配置。生成结果会自动转存到你的 CDN。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">开始使用</h2>
        <Link href="/app/images" className="btn-primary">进入图片生成</Link>
      </section>
    </div>
  )
}