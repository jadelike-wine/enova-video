import Link from 'next/link'

const docsNav = [
  {
    section: '入门',
    links: [
      { href: '/docs/getting-started', label: '快速开始' },
      { href: '/docs/api-key', label: 'API Key' },
    ],
  },
  {
    section: '功能指南',
    links: [
      { href: '/docs/image-generation', label: '图片生成' },
      { href: '/docs/video-generation', label: '视频生成' },
    ],
  },
]

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row gap-8">
      <aside className="md:w-56 flex-shrink-0">
        <h2 className="text-sm font-bold text-white/80 mb-4">文档</h2>
        <nav className="space-y-6" aria-label="文档导航">
          {docsNav.map((group) => (
            <div key={group.section}>
              <p className="text-xs text-white/40 mb-2">{group.section}</p>
              <ul className="space-y-1.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block px-3 py-2 rounded-xl text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <article className="flex-1 min-w-0 max-w-3xl">{children}</article>
    </div>
  )
}