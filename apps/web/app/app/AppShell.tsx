'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { DialogProvider } from '../../components/application/DialogProvider'
import { SessionProvider, useSession } from '../../lib/auth'
import { BRAND } from '../../lib/brand'

const navItems = [
  { path: '/app/chat', label: '文本对话', icon: '💬', gradient: 'from-violet-500 to-fuchsia-500', adminOnly: false },
  { path: '/app/images', label: '图片生成', icon: '🎨', gradient: 'from-pink-500 to-orange-400', adminOnly: false },
  { path: '/app/videos', label: '视频生成', icon: '🎬', gradient: 'from-cyan-400 to-blue-500', adminOnly: false },
  { path: '/app/wallet', label: '钱包', icon: '💰', gradient: 'from-emerald-400 to-cyan-500', adminOnly: false },
  { path: '/app/settings', label: '设置', icon: '⚙️', gradient: 'from-slate-400 to-zinc-500', adminOnly: false },
  { path: '/app/admin/settings', label: '系统配置', icon: '🛠️', gradient: 'from-amber-400 to-rose-500', adminOnly: true },
  { path: '/app/admin/system-update', label: '系统更新', icon: '🔄', gradient: 'from-cyan-400 to-blue-500', adminOnly: true },
]

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { loading, user, balance, logout } = useSession()

  // 鉴权守卫：未加载完成显示加载态；未登录重定向到登录页。
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-white/60 text-sm animate-pulse">加载中…</div>
      </div>
    )
  }
  if (!user) {
    router.replace('/auth/login')
    return null
  }

  return (
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

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems
            .filter((item) => !item.adminOnly || user?.role === 'ADMIN')
            .map((item) => {
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

        <div className="p-5 border-t border-white/10 space-y-3">
          {/* 余额 */}
          <Link href="/app/wallet" className="flex items-center justify-between glass rounded-2xl px-4 py-3 hover:border-white/30 transition-colors">
            <div>
              <p className="text-xs text-white/50">余额</p>
              <p className="font-bold text-cyan-300">{balance.toLocaleString()} <span className="text-xs font-normal text-white/50">Credits</span></p>
            </div>
            <span className="text-white/40">→</span>
          </Link>
          {/* 用户 + 登出 */}
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm text-white/80 truncate">{user.email}</p>
            </div>
            <button
              onClick={() => void logout()}
              className="btn-ghost text-xs"
              title="退出登录"
            >
              退出
            </button>
          </div>
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
  )
}

// 注意：此组件不能作为 app/app 下的嵌套 layout.tsx 使用。
// Next.js 15.5.x 存在 bug：当 app/app/layout.tsx 存在时，根 layout 引入的
// 全局 CSS 会被静默丢弃（构建成功但 .next/static/css 为空，页面无样式）。
// 因此这里用客户端组件包裹各个页面，而不是作为 layout 挂载。
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DialogProvider>
        <ShellInner>{children}</ShellInner>
      </DialogProvider>
    </SessionProvider>
  )
}
