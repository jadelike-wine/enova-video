import Link from 'next/link'
import { BRAND } from '../../lib/brand'

const groups = [
  {
    title: '产品',
    links: [
      { href: '/ai-chat', label: 'AI 对话' },
      { href: '/ai-image-generator', label: 'AI 图片生成' },
      { href: '/ai-video-generator', label: 'AI 视频生成' },
      { href: '/app/chat', label: '进入应用' },
    ],
  },
  {
    title: '模型',
    links: [
      { href: '/models', label: '全部模型' },
      { href: '/models/agnes-2-0-flash', label: 'Agnes 2.0 Flash' },
      { href: '/models/agnes-image-2-1-flash', label: 'Agnes Image 2.1 Flash' },
      { href: '/models/agnes-video-v2-0', label: 'Agnes Video V2.0' },
    ],
  },
  {
    title: '文档',
    links: [
      { href: '/docs/getting-started', label: '快速开始' },
      { href: '/docs/api-key', label: 'API Key' },
      { href: '/docs/image-generation', label: '图片生成' },
      { href: '/docs/video-generation', label: '视频生成' },
    ],
  },
]

export default function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-black/20">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 flex items-center justify-center text-base font-extrabold shadow-glow">
                {BRAND.logoMarkZh}
              </div>
              <span className="font-bold">{BRAND.nameZh}</span>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">
              {BRAND.nameZh}（{BRAND.name}）AI 智能创作平台，提供 AI 对话、AI 图片生成与 AI 视频生成的一体化创作体验。
            </p>
          </div>

          {groups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h3 className="text-sm font-semibold text-white/80 mb-3">{group.title}</h3>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/50 hover:text-cyan-300 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <p>© {new Date().getFullYear()} {BRAND.nameZh} · {BRAND.name}</p>
        </div>
      </div>
    </footer>
  )
}