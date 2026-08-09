import Link from 'next/link'

const navLinks = [
  { href: '/', label: '首页' },
  { href: '/ai-chat', label: 'AI 对话' },
  { href: '/ai-image-generator', label: 'AI 图片' },
  { href: '/ai-video-generator', label: 'AI 视频' },
  { href: '/models', label: '模型' },
  { href: '/docs/getting-started', label: '文档' },
]

export default function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 glass-sidebar border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 flex items-center justify-center text-lg font-extrabold shadow-glow">
            A
          </div>
          <span className="font-bold text-lg bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
            Agnes AI Creator
          </span>
        </Link>

        <nav aria-label="主导航" className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2 rounded-xl text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/app/chat" className="btn-primary text-sm px-4 py-2">
            开始使用
          </Link>
        </div>
      </div>
    </header>
  )
}