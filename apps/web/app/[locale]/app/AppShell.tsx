'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from '@/i18n.config'
import { useTranslations } from 'next-intl'
import { Button } from 'antd'
import { DialogProvider } from '@/components/application/DialogProvider'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { SessionProvider, useSession } from '@/lib/auth'
import { BRAND } from '@/lib/brand'
import { ContentLoading } from '@/components/application/admin/AdminUi'
import { SiteConfigProvider, useSiteConfig } from '@/lib/useSiteConfig'
import type { CustomMenuItem } from '@/lib/api'

// 普通用户（个人端）导航项
// 图片/视频为可展开菜单，包含「生成」和「历史记录」二级菜单
const userNavItems = [
  { path: '/app/wallet', labelKey: 'navigation.wallet', icon: '💰' },
  { path: '/app/settings', labelKey: 'navigation.settings', icon: '⚙️' },
]

// 可展开的生成菜单配置
const expandableMenus = [
  {
    basePath: '/app/images',
    labelKey: 'navigation.images',
    icon: '🎨',
    children: [
      { path: '/app/images', labelKey: 'navigation.generateImage' },
      { path: '/app/images/history', labelKey: 'navigation.history' },
    ],
  },
  {
    basePath: '/app/videos',
    labelKey: 'navigation.videos',
    icon: '🎬',
    children: [
      { path: '/app/videos', labelKey: 'navigation.generateVideo' },
      { path: '/app/videos/history', labelKey: 'navigation.history' },
    ],
  },
]

// 管理员后台导航项（仅管理员可见）
const adminNavItems = [
  { path: '/app/admin/dashboard', labelKey: 'navigation.adminDashboard', icon: '📊' },
  { path: '/app/admin/users', labelKey: 'navigation.adminUsers', icon: '👥' },
  { path: '/app/admin/orders', labelKey: 'navigation.adminOrders', icon: '💳' },
  { path: '/app/admin/generations', labelKey: 'navigation.adminGenerations', icon: '🎬' },
  { path: '/app/admin/providers', labelKey: 'navigation.adminProviders', icon: '🔌' },
  { path: '/app/admin/pricing', labelKey: 'navigation.adminPricing', icon: '💰' },
  { path: '/app/admin/audit', labelKey: 'navigation.adminAudit', icon: '🧾' },
  { path: '/app/admin/settings', labelKey: 'navigation.adminSettings', icon: '🛠️' },
  { path: '/app/admin/system-update', labelKey: 'navigation.adminSystemUpdate', icon: '🔄' },
]

// ---- 路由切换 pending 状态 ----
// 点击导航 Link 时立即设为 true，pathname 变化后清除。
// 在右侧 Content 区域覆盖 ContentLoading，不卸载 Sidebar。

const RoutePendingContext = createContext<{ pending: boolean; trigger: () => void }>({
  pending: false,
  trigger: () => {},
})
const useRoutePending = () => useContext(RoutePendingContext)

function RoutePendingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [pending, setPending] = useState(false)
  const prevPath = useRef(pathname)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // pathname 变化 → 路由已到达，清除 pending
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname
      setPending(false)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [pathname])

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // 点击导航时调用：立即标记 pending，同时设置安全超时兜底
  // 防止路由未完成导航（如同路径仅 query 变化）时 pending 永不清除
  const trigger = () => {
    setPending(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setPending(false), 5000)
  }

  return (
    <RoutePendingContext.Provider value={{ pending, trigger }}>
      {children}
    </RoutePendingContext.Provider>
  )
}

function NavLink({ item, pathname }: { item: { path: string; labelKey: string; icon: string }; pathname: string }) {
  const t = useTranslations()
  const { trigger } = useRoutePending()
  // pathname 来自 next-intl 的 usePathname，已去除 locale 前缀
  const active = pathname === item.path || pathname.startsWith(item.path + '/')
  return (
    <Link
      href={item.path}
      prefetch
      onClick={() => {
        if (active) return
        trigger()
      }}
      className={`nav-item ${active ? 'nav-item-active' : 'nav-item-inactive'}`}
    >
      <span
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
          active ? 'bg-gradient-to-br from-primary-500 to-primary-600' : 'bg-gray-100'
        }`}
      >
        {item.icon}
      </span>
      <span className="nav-item-label">{t(item.labelKey)}</span>
    </Link>
  )
}

/** 可展开的二级菜单导航组件 */
function ExpandableNavLink({
  menu,
  pathname,
}: {
  menu: (typeof expandableMenus)[number]
  pathname: string
}) {
  const t = useTranslations()
  const { trigger } = useRoutePending()
  const router = useRouter()

  // 判断当前是否处于该菜单的子路由下（包括生成页面和历史记录页面）
  const isChildRoute =
    pathname === menu.basePath || pathname.startsWith(menu.basePath + '/')

  // 当处于子路由时自动展开；也可手动收起
  const [expanded, setExpanded] = useState(false)

  // 路由变化时同步展开状态
  useEffect(() => {
    if (isChildRoute) setExpanded(true)
  }, [isChildRoute])

  const handleToggle = () => {
    if (!expanded) {
      // 展开：如果当前不在该菜单的子路由下，则跳转到默认生成页面
      setExpanded(true)
      if (!isChildRoute) {
        trigger()
        router.push(menu.basePath)
      }
    } else {
      // 收起
      setExpanded(false)
    }
  }

  return (
    <div>
      {/* 一级菜单：点击展开/收起 */}
      <button
        type="button"
        onClick={handleToggle}
        className={`nav-item w-full text-left ${isChildRoute ? 'nav-item-active' : 'nav-item-inactive'}`}
      >
        <span
          className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
            isChildRoute ? 'bg-gradient-to-br from-primary-500 to-primary-600' : 'bg-gray-100'
          }`}
        >
          {menu.icon}
        </span>
        <span className="nav-item-label flex-1">{t(menu.labelKey)}</span>
        <span className="text-gray-400 text-sm flex-shrink-0 ml-1">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {/* 二级菜单 */}
      {expanded && (
        <div className="ml-4 mt-1 space-y-1 border-l border-gray-100 pl-3">
          {menu.children.map((child) => {
            const childActive =
              pathname === child.path ||
              (child.path === menu.basePath && pathname === menu.basePath)
            return (
              <Link
                key={child.path}
                href={child.path}
                prefetch
                onClick={() => {
                  if (childActive) return
                  trigger()
                }}
                className={`flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                  childActive
                    ? 'text-primary-600 font-medium bg-primary-50/60'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 mr-2.5" />
                {t(child.labelKey)}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 自定义菜单项导航链接。 */
function CustomMenuLink({ item, pathname }: { item: CustomMenuItem; pathname: string }) {
  const { trigger } = useRoutePending()
  const customPath = `/app/custom/${item.id}`
  const active = pathname === customPath
  return (
    <Link
      href={customPath}
      prefetch={false}
      onClick={() => {
        if (active) return
        trigger()
      }}
      className={`nav-item ${active ? 'nav-item-active' : 'nav-item-inactive'}`}
    >
      <span
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
          active ? 'bg-gradient-to-br from-primary-500 to-primary-600' : 'bg-gray-100'
        }`}
      >
        🔗
      </span>
      <span className="nav-item-label">{item.label}</span>
    </Link>
  )
}

/** Logo 渲染：有配置 Logo 则用图片，否则用默认渐变占位。 */
function SiteLogo({ logoUrl, fallbackMark, size = 'w-12 h-12' }: { logoUrl: string; fallbackMark: string; size?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt="Logo"
        className={`${size} rounded-2xl object-cover`}
      />
    )
  }
  return (
    <div className={`${size} rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-xl font-extrabold text-white`}>
      {fallbackMark}
    </div>
  )
}

// 模块级变量：保存侧边栏滚动位置，跨路由切换持续（见上方注释）
let sidebarScrollTop = 0

function ShellInner({ children }: { children: React.ReactNode }) {
  const t = useTranslations()
  const pathname = usePathname()
  const router = useRouter()
  const { loading, user, balance, logout } = useSession()
  const { config: siteConfig } = useSiteConfig()
  const navRef = useRef<HTMLElement>(null)
  const { pending: routePending } = useRoutePending()

  // Layout 级别：ShellInner 在路由切换时保持 mounted，不再重新挂载。
  // sidebarScrollTop 仅在首次进入时恢复（浏览器硬刷新场景）。
  useEffect(() => {
    const nav = navRef.current
    if (nav) nav.scrollTop = sidebarScrollTop
  }, [])

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

  // 自定义菜单项：管理员可见所有，普通用户仅可见 visibility=user 的。
  const visibleCustomMenuItems = user?.role === 'ADMIN'
    ? siteConfig.customMenuItems
    : siteConfig.customMenuItems.filter((m) => m.visibility === 'user')

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between gap-3">
          <Link href="/" className="block min-w-0">
            <div className="flex items-center gap-4">
              <SiteLogo logoUrl={siteConfig.siteLogo} fallbackMark={BRAND.logoMarkZh} />
              <div className="min-w-0">
                <h1 className="font-bold text-lg leading-tight text-[#111827] truncate">{siteConfig.siteName || BRAND.nameZh}</h1>
                {siteConfig.siteSubtitle && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{siteConfig.siteSubtitle}</p>
                )}
              </div>
            </div>
          </Link>
          <LanguageSwitcher />
        </div>

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
                  <NavLink key={item.path} item={item} pathname={pathname} />
                ))}
              </div>

              {/* 个人（普通用户）区隔，参考 sub2api 管理后台：管理员能看到自己的个人菜单 */}
              <div className="mt-6 mb-2 flex items-center gap-3">
                <span className="text-[11px] uppercase tracking-widest text-gray-400">{t('navigation.myAccount')}</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-2">
                {expandableMenus.map((menu) => (
                  <ExpandableNavLink key={menu.basePath} menu={menu} pathname={pathname} />
                ))}
                {userNavItems.map((item) => (
                  <NavLink key={item.path} item={item} pathname={pathname} />
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {expandableMenus.map((menu) => (
                <ExpandableNavLink key={menu.basePath} menu={menu} pathname={pathname} />
              ))}
              {userNavItems.map((item) => (
                <NavLink key={item.path} item={item} pathname={pathname} />
              ))}
            </div>
          )}

          {/* 自定义菜单页面 */}
          {visibleCustomMenuItems.length > 0 && (
            <>
              <div className="mt-6 mb-2 flex items-center gap-3">
                <span className="text-[11px] uppercase tracking-widest text-gray-400">{t('navigation.customPages')}</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-2">
                {visibleCustomMenuItems.map((item) => (
                  <CustomMenuLink key={item.id} item={item} pathname={pathname} />
                ))}
              </div>
            </>
          )}

          {/* 文档链接 */}
          {siteConfig.docUrl && (
            <div className="mt-6 space-y-2">
              <a
                href={siteConfig.docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-item nav-item-inactive"
              >
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-gray-100">
                  📖
                </span>
                <span className="nav-item-label">{t('navigation.documentation')}</span>
              </a>
            </div>
          )}
        </nav>

        <div className="p-5 border-t border-gray-100 space-y-3">
          {/* 余额 */}
          <Link
            href="/app/wallet"
            className="flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-4 py-3 hover:border-gray-200 transition-colors"
          >
            <div>
              <p className="text-xs text-gray-500">{t('appShell.balance')}</p>
              <p className="font-bold text-primary-600">
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
            © {new Date().getFullYear()} {siteConfig.siteName || BRAND.nameZh} · {BRAND.name}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden bg-slate-50">
        <div className="relative h-full m-4 bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)' }}>
          {children}
          {routePending && (
            <div className="absolute inset-0 z-10 bg-white">
              <ContentLoading />
            </div>
          )}
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
      <SiteConfigProvider>
        <DialogProvider>
          <RoutePendingProvider>
            <ShellInner>{children}</ShellInner>
          </RoutePendingProvider>
        </DialogProvider>
      </SiteConfigProvider>
    </SessionProvider>
  )
}
