import Link from 'next/link'
import { BRAND } from '../../lib/brand'

export function CTA() {
  return (
    <section className="glass-card text-center py-12 px-6">
      <h2 className="text-2xl md:text-3xl font-extrabold mb-3">立即开始使用 {BRAND.nameZh}</h2>
      <p className="text-white/60 mb-8 max-w-2xl mx-auto">
        开始对话、生成图片或视频，体验 {BRAND.nameZh} 的一体化 AI 创作能力。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link href="/app/chat" className="btn-primary">
          Start Chatting
        </Link>
        <Link href="/app/images" className="btn-secondary">
          Generate Images
        </Link>
        <Link href="/app/videos" className="btn-secondary">
          Generate Videos
        </Link>
      </div>
    </section>
  )
}