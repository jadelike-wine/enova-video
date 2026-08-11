import type { Metadata } from 'next'
import Link from 'next/link'
import MarketingLayout from '../components/marketing/MarketingLayout'
import { ModelGrid } from '../components/marketing/ModelCard'
import { FAQ } from '../components/marketing/FAQ'
import { buildMetadata, SITE_NAME, SITE_TAGLINE, absoluteUrl } from '../lib/seo'
import { BRAND } from '../lib/brand'

export const metadata: Metadata = buildMetadata({
  title: { absolute: `${SITE_NAME} – ${SITE_TAGLINE}` },
  description:
    '灵动创影（EnovaMotion）是一个 AI 智能创作平台，支持 AI 对话、AI 图片生成与 AI 视频生成。基于 Agnes AI 模型，立即开始创作。',
  path: '/',
})

const features = [
  {
    href: '/ai-chat',
    title: 'AI 对话',
    desc: '基于 Agnes 2.0 Flash 的多轮文本对话，支持流式逐字输出、Markdown 渲染、Thinking 模式与 Token 统计。',
    icon: '💬',
  },
  {
    href: '/ai-image-generator',
    title: 'AI 图片生成',
    desc: '基于 Agnes Image 2.1 Flash 的文生图、单图编辑与多图合成，支持多种尺寸，生成结果自动转存对象存储。',
    icon: '🎨',
  },
  {
    href: '/ai-video-generator',
    title: 'AI 视频生成',
    desc: '基于 Agnes Video V2.0 的文生视频、图生视频、多图视频与关键帧动画，后台异步轮询任务进度。',
    icon: '🎬',
  },
]

const faqs = [
  {
    q: '灵动创影是什么？',
    a: '灵动创影（EnovaMotion）是一个 AI 智能创作平台，提供 AI 对话、AI 图片生成和 AI 视频生成三大能力，底层使用 Agnes AI 模型。',
  },
  {
    q: '支持自托管部署吗？',
    a: '可以。平台由 Next.js 前端与 FastAPI 后端组成，后端使用 SQLite 存储，支持本地或服务器部署。',
  },
  {
    q: '支持哪些模型？',
    a: '文本对话支持 Agnes 2.0 Flash，图片生成支持 Agnes Image 2.1 Flash，视频生成支持 Agnes Video V2.0，均可从应用内模型选择器切换。',
  },
]

export default function HomePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    applicationCategory: 'CreativeWorkApplication',
    operatingSystem: 'Web',
    description:
      '灵动创影（EnovaMotion）是一个 AI 智能创作平台，支持 AI 对话、AI 图片生成与 AI 视频生成。',
    url: absoluteUrl('/'),
    inLanguage: 'zh-CN',
    featureList: ['AI 对话', 'AI 图片生成', 'AI 视频生成'],
  }

  return (
    <MarketingLayout>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl md:text-6xl font-extrabold leading-tight bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
          AI 智能创作平台
        </h1>
        <p className="mt-6 text-lg text-white/70 max-w-3xl mx-auto leading-relaxed">
          {BRAND.nameZh} 将 AI 对话、AI 图片生成与 AI 视频生成整合到一个简洁的 AI 创作平台中。基于 Agnes AI 模型，即刻开始创作。
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href="/app/chat" className="btn-primary text-base px-8 py-3">
            开始对话
          </Link>
          <Link href="/app/images" className="btn-secondary text-base px-8 py-3">
            生成图片
          </Link>
          <Link href="/app/videos" className="btn-secondary text-base px-8 py-3">
            生成视频
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-extrabold mb-8 text-center">核心功能</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {features.map((feature) => (
            <Link
              key={feature.title}
              href={feature.href}
              className="glass-card block group hover:border-white/30 transition-all duration-200"
            >
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl mb-4">
                {feature.icon}
              </div>
              <h3 className="font-bold text-white group-hover:text-cyan-300 transition-colors mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-white/60 leading-relaxed">{feature.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Models */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-end justify-between mb-6">
          <h2 className="text-2xl font-extrabold">支持模型</h2>
          <Link href="/models" className="text-sm text-cyan-300 hover:underline">
            查看全部模型 →
          </Link>
        </div>
        <ModelGrid />
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-12">
        <FAQ items={faqs} />
      </section>
    </MarketingLayout>
  )
}