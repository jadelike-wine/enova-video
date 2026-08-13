import Link from 'next/link'
import { BRAND } from '../../lib/brand'

export function CTA() {
  return (
    <section className="glass-card text-center py-12 px-6">
      <h2 className="text-2xl md:text-3xl font-bold mb-3 text-[#111827] tracking-tight">立即开始使用 {BRAND.nameZh}</h2>
      <p className="text-[#6B7280] mb-8 max-w-2xl mx-auto">
        生成图片或视频，体验 {BRAND.nameZh} 的 AI 创作能力。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link href="/app/images" className="btn-primary">
          生成图片
        </Link>
        <Link href="/app/videos" className="btn-secondary">
          生成视频
        </Link>
      </div>
    </section>
  )
}