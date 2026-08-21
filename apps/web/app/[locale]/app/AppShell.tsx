'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from '@/i18n.config'
import { useTranslations } from 'next-intl'
import { Button } from 'antd'
import {
  AppstoreOutlined,
  DownOutlined,
  ExperimentOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PictureOutlined,
  SettingOutlined,
  VideoCameraOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { DialogProvider } from '@/components/application/DialogProvider'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { SessionProvider, useSession } from '@/lib/auth'
import { BRAND } from '@/lib/brand'
import { ContentLoading } from '@/components/application/admin/AdminUi'
import { SiteConfigProvider, useSiteConfig } from '@/lib/useSiteConfig'
import type { CustomMenuItem } from '@/lib/api'
import { workspaceShellMode } from '@/components/application/image-creator/workbench'
import { assetNavItem, getSidebarItemClass, hasActiveSidebarChild, isSidebarItemActive } from './sidebar-navigation'

// 普通用户（个人端）导航项
// 图片/视频为可展开菜单，包含「生成」和「历史记录」二级菜单
const userNavItems = [
  { path: '/app/settings', labelKey: 'navigation.settings', icon: <SettingOutlined /> },
]

// 可展开的生成菜单配置
type NavChild = { path: string; labelKey: string; disabled?: boolean }
type ExpandableMenu = { basePath: string; labelKey: string; icon: ReactNode; children: NavChild[] }

const expandableMenus: ExpandableMenu[] = [
  {
    basePath: '/app/images',
    labelKey: 'navigation.images',
    icon: <PictureOutlined />,
    children: [
      { path: '/app/images', labelKey: 'navigation.generateImage' },
      { path: '/app/images/history', labelKey: 'navigation.history' },
    ],
  },
  {
    basePath: '/app/videos',
    labelKey: 'navigation.videos',
    icon: <VideoCameraOutlined />,
    children: [
      { path: '/app/videos', labelKey: 'navigation.generateVideo' },
      { path: '/app/videos/history', labelKey: 'navigation.history' },
    ],
  },
]

const creatorGenerationMenu: ExpandableMenu = {
  basePath: '/app/images',
  labelKey: 'navigation.generate',
  icon: <ExperimentOutlined />,
  children: [
    { path: '/app/images', labelKey: 'navigation.generateImage' },
    { path: '/app/videos', labelKey: 'navigation.generateVideo' },
  ],
}

const assetNavLinkItem = { ...assetNavItem, icon: <FolderOpenOutlined /> }

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

function NavLink({ item, pathname, collapsed = false }: { item: { path: string; labelKey: string; icon: ReactNode }; pathname: string; collapsed?: boolean }) {
  const t = useTranslations()
  const { trigger } = useRoutePending()
  // pathname 来自 next-intl 的 usePathname，已去除 locale 前缀
  const active = isSidebarItemActive(pathname, item.path)
  return (
    <Link
      href={item.path}
      prefetch
      onClick={() => {
        if (active) return
        trigger()
      }}
      title={collapsed ? t(item.labelKey) : undefined}
      className={`nav-item ${collapsed ? 'nav-item-collapsed' : ''} ${active ? 'nav-item-active' : 'nav-item-inactive'}`}
    >
      <span className="nav-item-icon">
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
  collapsed = false,
}: {
  menu: ExpandableMenu
  pathname: string
  collapsed?: boolean
}) {
  const t = useTranslations()
  const { trigger } = useRoutePending()
  const router = useRouter()

  // 判断当前是否处于该菜单的子路由下。
  // 精确匹配 basePath 或子菜单项路径，以及子菜单项路径的子路径。
  // 不用 basePath 做宽泛前缀匹配，否则 /app/images/history 会误匹配 basePath 为 /app/images 的菜单。
  const isChildRoute = hasActiveSidebarChild(pathname, menu.children)

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
    <div className={collapsed ? 'nav-group-collapsed' : ''}>
      {/* 一级菜单：点击展开/收起 */}
      <button
        type="button"
        onClick={handleToggle}
        title={collapsed ? t(menu.labelKey) : undefined}
        className={`nav-item w-full text-left ${collapsed ? 'nav-item-collapsed' : ''} ${getSidebarItemClass({ pathname, itemPath: menu.basePath, parent: true })}`}
      >
        <span className="nav-item-icon">
          {menu.icon}
        </span>
        <span className="nav-item-label flex-1">{t(menu.labelKey)}</span>
        <span className="nav-chevron">
          {expanded ? <DownOutlined /> : <DownOutlined className="-rotate-90" />}
        </span>
      </button>

      {/* 二级菜单 */}
      {expanded && (
        <div className="nav-submenu">
          {menu.children.map((child) => {
            if (child.disabled) {
              return (
                <div key={child.labelKey} className="nav-subitem nav-subitem-disabled">
                  <span className="nav-subitem-dot" />
                  {t(child.labelKey)}
                </div>
              )
            }
            const childActive = isSidebarItemActive(pathname, child.path)
            return (
              <Link
                key={child.path}
                href={child.path}
                prefetch
                onClick={() => {
                  if (childActive) return
                  trigger()
                }}
                className={`nav-subitem ${
                  childActive
                    ? 'nav-subitem-active'
                    : 'nav-subitem-inactive'
                }`}
              >
                <span className="nav-subitem-dot" />
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
function CustomMenuLink({ item, pathname, collapsed = false }: { item: CustomMenuItem; pathname: string; collapsed?: boolean }) {
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
      title={collapsed ? item.label : undefined}
      className={`nav-item ${collapsed ? 'nav-item-collapsed' : ''} ${active ? 'nav-item-active' : 'nav-item-inactive'}`}
    >
      <span className="nav-item-icon"><AppstoreOutlined /></span>
      <span className="nav-item-label">{item.label}</span>
    </Link>
  )
}

/** Logo 渲染：有配置 Logo 则用图片，否则用默认渐变占位。 */
function SiteLogo({ logoUrl, fallbackMark, size = 'w-9 h-9' }: { logoUrl: string; fallbackMark: string; size?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt="Logo"
        className={`${size} rounded-xl object-cover`}
      />
    )
  }
  return (
    <div className={`${size} rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-base font-extrabold text-white`}>
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
  const isAdminRoute = workspaceShellMode(pathname) === 'admin'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

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
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Sidebar */}
      {mobileSidebarOpen && <button aria-label={t('appShell.closeSidebar')} className="sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} />}
      <aside className={`app-sidebar ${sidebarCollapsed ? 'app-sidebar-collapsed' : ''} ${mobileSidebarOpen ? 'app-sidebar-mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Link href="/" className="block min-w-0">
            <div className="flex items-center gap-3">
              <SiteLogo logoUrl={siteConfig.siteLogo} fallbackMark={BRAND.logoMarkZh} />
              <div className="min-w-0">
                <h1 className="font-semibold text-[15px] leading-tight text-slate-900 truncate">{siteConfig.siteName || BRAND.name}</h1>
                <p className="text-[11px] text-slate-400 mt-0.5 truncate">{siteConfig.siteSubtitle || t('appShell.tagline')}</p>
              </div>
            </div>
          </Link>
          <div className="sidebar-brand-actions">
            <button type="button" className="sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={t(sidebarCollapsed ? 'appShell.expandSidebar' : 'appShell.collapseSidebar')}>
              {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
          </div>
        </div>

        <nav
          ref={navRef}
          onScroll={(e) => {
            sidebarScrollTop = e.currentTarget.scrollTop
          }}
          className="app-sidebar-nav"
        >
          {isAdminRoute && user?.role === 'ADMIN' ? (
            <>
              {/* 管理员后台 */}
            <div className="space-y-1.5">
                {adminNavItems.map((item) => (
                  <NavLink key={item.path} item={{ ...item, icon: <ExperimentOutlined /> }} pathname={pathname} collapsed={sidebarCollapsed} />
                ))}
              </div>

              {/* 个人（普通用户）区隔，参考 sub2api 管理后台：管理员能看到自己的个人菜单 */}
              <div className="mt-6 mb-2 flex items-center gap-3">
                <span className="text-[11px] uppercase tracking-widest text-gray-400">{t('navigation.myAccount')}</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-1.5">
                {expandableMenus.map((menu) => (
                  <ExpandableNavLink key={menu.basePath} menu={menu} pathname={pathname} collapsed={sidebarCollapsed} />
                ))}
                <NavLink item={assetNavLinkItem} pathname={pathname} collapsed={sidebarCollapsed} />
                {userNavItems.map((item) => (
                  <NavLink key={item.path} item={item} pathname={pathname} collapsed={sidebarCollapsed} />
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <ExpandableNavLink menu={creatorGenerationMenu} pathname={pathname} collapsed={sidebarCollapsed} />
              <NavLink item={assetNavLinkItem} pathname={pathname} collapsed={sidebarCollapsed} />
              {userNavItems.map((item) => (
                <NavLink key={item.path} item={item} pathname={pathname} collapsed={sidebarCollapsed} />
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
                  <CustomMenuLink key={item.id} item={item} pathname={pathname} collapsed={sidebarCollapsed} />
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
                className={`nav-item nav-item-inactive ${sidebarCollapsed ? 'nav-item-collapsed' : ''}`}
              >
                  <span className="nav-item-icon"><FileImageOutlined /></span>
                <span className="nav-item-label">{t('navigation.documentation')}</span>
              </a>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          {/* 余额 */}
          <Link
            href="/app/wallet"
            title={sidebarCollapsed ? `${t('appShell.balance')}: ${balance.toLocaleString()}` : undefined}
            className={`credits-link ${sidebarCollapsed ? 'credits-link-collapsed' : ''}`}
          >
            <WalletOutlined className="credits-icon" />
            <div className="credits-copy">
              <p className="text-[11px] text-slate-400">{t('appShell.balance')}</p>
              <p className="font-semibold text-primary-600 text-sm">
                {balance.toLocaleString()} <span className="text-xs font-normal text-gray-500">Credits</span>
              </p>
            </div>
            {!sidebarCollapsed && <span className="text-slate-300">→</span>}
          </Link>
          {/* 用户 + 登出 */}
          <div className={`account-row ${sidebarCollapsed ? 'account-row-collapsed' : ''}`}>
            <div className="account-avatar">{user.email.slice(0, 1).toUpperCase()}</div>
            <div className="account-copy min-w-0">
              <p className="text-sm text-gray-700 truncate">{user.email}</p>
              <p className="text-[11px] text-slate-400">{t('appShell.account')}</p>
            </div>
            <Button type="text" size="small" icon={<LogoutOutlined />} onClick={() => void logout()} title={t('appShell.logoutTitle')} className="logout-button">
              {!sidebarCollapsed && t('appShell.logout')}
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className={`app-main flex-1 overflow-hidden ${sidebarCollapsed ? 'app-main-collapsed' : ''}`}>
        <button type="button" className="mobile-sidebar-trigger" onClick={() => setMobileSidebarOpen(true)} aria-label={t('appShell.openSidebar')}>
          <MenuUnfoldOutlined />
        </button>
        <div className="app-main-lang-switcher">
          <LanguageSwitcher />
        </div>
        <div className="relative h-full bg-white overflow-hidden">
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
