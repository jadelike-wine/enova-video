'use client'

import Link from 'next/link'
import { useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { DialogProvider } from '../../components/application/DialogProvider'
import { SessionProvider, useSession } from '../../lib/auth'
import { BRAND } from '../../lib/brand'

// 普通用户（个人端）导航项
const userNavItems = [
  { path: '/app/images', label: '图片生成', icon: '🎨' },
  { path: '/app/videos', label: '视频生成', icon: '🎬' },
  { path: '/app/wallet', label: '钱包', icon: '💰' },
  { path: '/app/settings', label: '设置', icon: '⚙️' },
]

// 管理员后台导航项（仅管理员可见）
const adminNavItems = [
  { path: '/app/admin/dashboard', label: '运营概览', icon: '📊' },
  { path: '/app/admin/users', label: '用户管理', icon: '👥' },
  { path: '/app/admin/orders', label: '订单 / 支付', icon: '💳' },
  { path: '/app/admin/generations', label: '生成任务', icon: '🎬' },
  { path: '/app/admin/audit', label: '审计日志', icon: '🧾' },
  { path: '/app/admin/settings', label: '系统配置', icon: '🛠️' },
  { path: '/app/admin/system-update', label: '系统更新', icon: '🔄' },
]

type NavItemProps = {
  item: { path: string; label: string; icon: string }
  pathname: string
  onTabClick: (e: React.MouseEvent<HTMLAnchorElement>, href: string) => void
}

function NavLink({ item, pathname, onTabClick }: NavItemProps) {
  const active = pathname.startsWith(item.path)
  return (
    <Link
      href={item.path}
      onClick={(e) => onTabClick(e, item.path)}
      className={`nav-item ${active ? 'nav-item-active' : 'nav-item-inactive'}`}
    >
      <span
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${
          active ? 'bg-gradient-to-br from-[#7C3AED] to-[#06B6D4]' : 'bg-gray-100'
        }`}
      >
        {item.icon}
      </span>
      {item.label}
    </Link>
  )
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { loading, user, balance, logout } = useSession()

  // 平滑过渡：切换侧边栏 tab 时用 View Transitions API 做淡入淡出，
  // 避免整页“闪一下”。不支持该 API 的浏览器会自动退化为普通导航。
  const handleTabClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (href === pathname) return
      const prefersReducedMotion =
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReducedMotion || typeof document.startViewTransition !== 'function') return
      e.preventDefault()
      document.startViewTransition(() => {
        router.push(href)
      })
    },
    [pathname, router],
  )

  // 鉴权守卫：未加载完成显示加载态；未登录重定向到登录页。
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-gray-500 text-sm animate-pulse">加载中…</div>
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
      <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <Link href="/" className="p-6 border-b border-gray-200 block">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center text-xl font-extrabold text-white">
              {BRAND.logoMarkZh}
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight text-[#111827]">{BRAND.nameZh}</h1>
              <p className="text-xs text-gray-500 mt-0.5">AI 智能创作平台</p>
            </div>
          </div>
        </Link>

        <nav className="flex-1 p-4 overflow-y-auto">
          {user?.role === 'ADMIN' ? (
            <>
              {/* 管理员后台 */}
              <div className="space-y-2">
                {adminNavItems.map((item) => (
                  <NavLink key={item.path} item={item} pathname={pathname} onTabClick={handleTabClick} />
                ))}
              </div>

              {/* 个人（普通用户）区隔，参考 sub2api 管理后台：管理员能看到自己的个人菜单 */}
              <div className="mt-6 mb-2 flex items-center gap-3">
                <span className="text-[11px] uppercase tracking-widest text-gray-400">我的账户</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-2">
                {userNavItems.map((item) => (
                  <NavLink key={item.path} item={item} pathname={pathname} onTabClick={handleTabClick} />
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {userNavItems.map((item) => (
                <NavLink key={item.path} item={item} pathname={pathname} onTabClick={handleTabClick} />
              ))}
            </div>
          )}
        </nav>

        <div className="p-5 border-t border-gray-200 space-y-3">
          {/* 余额 */}
          <Link
            href="/app/wallet"
            className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3 hover:border-gray-300 transition-colors"
          >
            <div>
              <p className="text-xs text-gray-500">余额</p>
              <p className="font-bold text-[#06B6D4]">
                {balance.toLocaleString()} <span className="text-xs font-normal text-gray-500">Credits</span>
              </p>
            </div>
            <span className="text-gray-400">→</span>
          </Link>
          {/* 用户 + 登出 */}
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm text-gray-700 truncate">{user.email}</p>
            </div>
            <button onClick={() => void logout()} className="btn-ghost text-xs" title="退出登录">
              退出
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center">
            © {new Date().getFullYear()} {BRAND.nameZh} · {BRAND.name}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden bg-[#F7F7F8]">
        <div className="h-full m-4 bg-white rounded-2xl border border-gray-200 overflow-hidden" style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)' }}>
          {children}
        </div>
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