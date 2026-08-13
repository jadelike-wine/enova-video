import type { Metadata } from 'next'
import Link from 'next/link'
import MarketingLayout from '../components/marketing/MarketingLayout'
import { buildMetadata, SITE_NAME, SITE_TAGLINE, absoluteUrl } from '../lib/seo'
import { BRAND } from '../lib/brand'

export const metadata: Metadata = buildMetadata({
  title: { absolute: `${SITE_NAME} – ${SITE_TAGLINE}` },
  description:
    '灵动创影（EnovaMotion）是一个 AI 智能创作平台，支持 AI 图片生成与 AI 视频生成。立即开始创作。',
  path: '/',
})

const features = [
  {
    href: '/app/images',
    title: 'AI 图片生成',
    desc: '文生图、单图编辑与多图合成，支持多种尺寸，生成结果自动转存对象存储。',
    icon: '🎨',
    iconBg: 'bg-sky-100',
  },
  {
    href: '/app/videos',
    title: 'AI 视频生成',
    desc: '文生视频、图生视频、多图视频与关键帧动画，后台异步轮询任务进度。',
    icon: '🎬',
    iconBg: 'bg-orange-100',
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
      '灵动创影（EnovaMotion）是一个 AI 智能创作平台，支持 AI 图片生成与 AI 视频生成。',
    url: absoluteUrl('/'),
    inLanguage: 'zh-CN',
    featureList: ['AI 图片生成', 'AI 视频生成'],
  }

  return (
    <MarketingLayout>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Hero */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium text-[#7C3AED] bg-[#7C3AED]/10 border border-[#7C3AED]/20 mb-6">
            ✨ {BRAND.taglineEn}
          </span>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight text-[#111827] tracking-tight">
            AI 智能创作平台
          </h1>
          <p className="mt-6 text-lg text-[#6B7280] max-w-3xl mx-auto leading-relaxed">
            {BRAND.nameZh} 将 AI 图片生成与 AI 视频生成整合到一个简洁的 AI 创作平台中，即刻开始创作。
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/app/images"
              className="btn-primary text-base px-8"
              style={{ minHeight: 48, borderRadius: 12 }}
            >
              开始创作
            </Link>
            <Link
              href="/app/videos"
              className="btn-secondary text-base px-8"
              style={{ minHeight: 48, borderRadius: 12 }}
            >
              生成视频
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-[#F9FAFB]">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-2xl md:text-3xl font-bold text-[#111827] mb-3 text-center tracking-tight">核心功能</h2>
          <p className="text-[#6B7280] text-center mb-12">一站式 AI 创作工作台，从灵感到成品输出</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {features.map((feature) => (
              <Link
                key={feature.title}
                href={feature.href}
                className="group bg-white rounded-2xl p-6 border border-[#E5E7EB] transition-all duration-300 hover:-translate-y-1"
                style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)' }}
              >
                <div
                  className={`w-14 h-14 rounded-full ${feature.iconBg} flex items-center justify-center text-2xl mb-5`}
                >
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold text-[#111827] mb-2 group-hover:text-[#7C3AED] transition-colors">
                  {feature.title}
                </h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{feature.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </MarketingLayout>
  )
}