import type { Metadata } from 'next'
import MarketingLayout from '../../components/marketing/MarketingLayout'
import { ModelGrid } from '../../components/marketing/ModelCard'
import { buildMetadata } from '../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: 'Models',
  description:
    '灵动创影支持的 AI 模型合集：Agnes 2.0 Flash 文本对话、Agnes Image 2.1 Flash 图片生成、Agnes Video V2.0 视频生成。',
  path: '/models',
})

export default function ModelsPage() {
  return (
    <MarketingLayout>
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <h1 className="text-4xl font-extrabold bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
          支持模型
        </h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          灵动创影基于 Agnes AI 模型构建，覆盖文本对话、图片生成与视频生成三大能力。点击模型卡片查看详情与使用方式。
        </p>
        <div className="mt-10">
          <ModelGrid />
        </div>
      </section>
    </MarketingLayout>
  )
}