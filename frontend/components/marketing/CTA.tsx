import Link from 'next/link'

export function CTA() {
  return (
    <section className="glass-card text-center py-12 px-6">
      <h2 className="text-2xl md:text-3xl font-extrabold mb-3">立即开始使用 Agnes AI Creator</h2>
      <p className="text-white/60 mb-8 max-w-2xl mx-auto">
        免费、开源、可自托管。开始对话、生成图片或视频，体验 Agnes AI 的多模态能力。
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
        <a
          href="https://github.com/jiyiren/agnes-ai-creator"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost"
        >
          View on GitHub
        </a>
      </div>
    </section>
  )
}