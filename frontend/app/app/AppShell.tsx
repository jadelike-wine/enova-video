'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DialogProvider } from '../../components/application/DialogProvider'
import { BRAND } from '../../lib/brand'

const navItems = [
  { path: '/app/chat', label: '文本对话', icon: '💬', gradient: 'from-violet-500 to-fuchsia-500' },
  { path: '/app/images', label: '图片生成', icon: '🎨', gradient: 'from-pink-500 to-orange-400' },
  { path: '/app/videos', label: '视频生成', icon: '🎬', gradient: 'from-cyan-400 to-blue-500' },
  { path: '/app/settings', label: '设置', icon: '⚙️', gradient: 'from-slate-400 to-zinc-500' },
]

// 注意：此组件不能作为 app/app 下的嵌套 layout.tsx 使用。
// Next.js 15.5.x 存在 bug：当 app/app/layout.tsx 存在时，根 layout 引入的
// 全局 CSS 会被静默丢弃（构建成功但 .next/static/css 为空，页面无样式）。
// 因此这里用客户端组件包裹各个页面，而不是作为 layout 挂载。
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <DialogProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 flex-shrink-0 glass-sidebar rounded-r-3xl flex flex-col m-2 mr-0">
          <Link href="/" className="p-6 border-b border-white/10 block">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 flex items-center justify-center text-xl font-extrabold shadow-glow">
                {BRAND.logoMarkZh}
              </div>
              <div>
                <h1 className="font-extrabold text-lg leading-tight bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                  {BRAND.nameZh}
                </h1>
                <p className="text-xs text-white/50 mt-0.5">AI 智能创作平台</p>
              </div>
            </div>
          </Link>

          <nav className="flex-1 p-4 space-y-2">
            {navItems.map((item) => {
              const active = pathname.startsWith(item.path)
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`nav-item ${active ? 'nav-item-active' : 'nav-item-inactive'}`}
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${
                      active ? `bg-gradient-to-br ${item.gradient} shadow-glow-cyan` : 'bg-white/10'
                    }`}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="p-5 border-t border-white/10">
            <p className="text-xs text-white/40 text-center">
              © {new Date().getFullYear()} {BRAND.nameZh} · {BRAND.name}
            </p>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden p-2 pl-0">
          <div className="h-full glass rounded-3xl overflow-hidden">{children}</div>
        </main>
      </div>
    </DialogProvider>
  )
}