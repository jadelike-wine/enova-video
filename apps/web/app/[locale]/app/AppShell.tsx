'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from 'antd'
import { DialogProvider } from '@/components/application/DialogProvider'
import { SessionProvider, useSession } from '@/lib/auth'
import { BRAND } from '@/lib/brand'

// 模块级变量：持久化侧边栏滚动位置。
// AppShell 在每个页面组件内独立渲染，路由切换会重新挂载整个 ShellInner，
// 因此不能用组件 state 保存滚动位置。模块作用域在同一个 SPA 会话内不会销毁，
// 跨路由切换（图片/视频/钱包/设置等）可稳定保持滚动位置；
// 刷新浏览器后模块重新加载并回到默认顶部，符合预期。

// 普通用户（个人端）导航项
const userNavItems = [
  { path: '/app/images', labelKey: 'navigation.images', icon: '🎨' },
  { path: '/app/videos', labelKey: 'navigation.videos', icon: '🎬' },
  { path: '/app/wallet', labelKey: 'navigation.wallet', icon: '💰' },
  { path: '/app/settings', labelKey: 'navigation.settings', icon: '⚙️' },
]

// 管理员后台导航项（仅管理员可见）
const adminNavItems = [
  { path: '/app/admin/dashboard', labelKey: 'navigation.adminDashboard', icon: '📊' },
  { path: '/app/admin/users', labelKey: 'navigation.adminUsers', icon: '👥' },
  { path: '/app/admin/orders', labelKey: 'navigation.adminOrders', icon: '💳' },
  { path: '/app/admin/generations', labelKey: 'navigation.adminGenerations', icon: '🎬' },
  { path: '/app/admin/audit', labelKey: 'navigation.adminAudit', icon: '🧾' },
  { path: '/app/admin/settings', labelKey: 'navigation.adminSettings', icon: '🛠️' },
  { path: '/app/admin/system-update', labelKey: 'navigation.adminSystemUpdate', icon: '🔄' },
]

type NavItemProps = {
  item: { path: string; labelKey: string; icon: string }
  pathname: string
  onTabClick: (e: React.MouseEvent<HTMLAnchorElement>, href: string) => void
}

function NavLink({ item, pathname, onTabClick }: NavItemProps) {
  const t = useTranslations()
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
      {t(item.labelKey)}
    </Link>
  )
}

// 模块级变量：保存侧边栏滚动位置，跨路由切换持续（见上方注释）
let sidebarScrollTop = 0

function ShellInner({ children }: { children: React.ReactNode }) {
  const t = useTranslations()
  const pathname = usePathname()
  const router = useRouter()
  const { loading, user, balance, logout } = useSession()
  const navRef = useRef<HTMLElement>(null)

  // 路由切换后 ShellInner 重新挂载，恢复侧边栏滚动位置。
  // 依赖留空：仅在首次挂载（含每次切页后的重新挂载）时执行一次。
  useEffect(() => {
    const nav = navRef.current
    if (nav) nav.scrollTop = sidebarScrollTop
  }, [])

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
        <div className="text-gray-500 text-sm animate-pulse">{t('appShell.loading')}</div>
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
              <p className="text-xs text-gray-500 mt-0.5">{t('appShell.tagline')}</p>
            </div>
          </div>
        </Link>

        <nav
          ref={navRef}
          onScroll={(e) => {
            sidebarScrollTop = e.currentTarget.scrollTop
          }}
          className="flex-1 p-4 overflow-y-auto"
        >
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
                <span className="text-[11px] uppercase tracking-widest text-gray-400">{t('navigation.myAccount')}</span>
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
              <p className="text-xs text-gray-500">{t('appShell.balance')}</p>
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
            <Button type="text" size="small" danger onClick={() => void logout()} title={t('appShell.logoutTitle')}>
              {t('appShell.logout')}
            </Button>
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

// 此组件现在由 app/[locale]/app/layout.tsx 挂载为共享 Layout。
// 路由切换时 Layout 保持 mounted，Sidebar 不会卸载，避免白屏。
// SessionProvider 也随之持久化，不会因路由切换重新请求 /auth/me。
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DialogProvider>
        <ShellInner>{children}</ShellInner>
      </DialogProvider>
    </SessionProvider>
  )
}