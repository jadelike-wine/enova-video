'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { publicApi, type SiteConfig } from './api'

/** 默认站点配置（API 不可用时的 fallback）。 */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteUrl: 'http://localhost:3000',
  supportEmail: 'support@example.com',
  siteName: 'EnovaMotion',
  siteSubtitle: 'AI 智能创作平台',
  siteLogo: '',
  contactInfo: 'support@example.com',
  docUrl: '',
  homeContent: '',
  compactHomeEnabled: false,
  hideCcsImportButton: false,
  customMenuItems: [],
  tableDefaultPageSize: 20,
  tablePageSizeOptions: [10, 20, 50, 100],
}

interface SiteConfigContextValue {
  config: SiteConfig
  loading: boolean
  /** 重新拉取配置。 */
  refresh: () => Promise<void>
}

const SiteConfigContext = createContext<SiteConfigContextValue>({
  config: DEFAULT_SITE_CONFIG,
  loading: false,
  refresh: async () => {},
})

export function useSiteConfig() {
  return useContext(SiteConfigContext)
}

/** SiteConfigProvider：在应用根部加载并缓存公开站点配置。 */
export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await publicApi.siteConfig()
      setConfig(data)
    } catch {
      // 保持默认值
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <SiteConfigContext.Provider value={{ config, loading, refresh }}>
      {children}
    </SiteConfigContext.Provider>
  )
}

/**
 * 解析首页内容类型。
 * - 'iframe'：内容以 http:// 或 https:// 开头，使用 iframe 渲染。
 * - 'markdown'：其他非空内容，按 Markdown/HTML 渲染。
 * - 'none'：内容为空。
 */
export type HomeContentType = 'iframe' | 'markdown' | 'none'

export function resolveHomeContent(content: string): HomeContentType {
  const trimmed = content.trim()
  if (!trimmed) return 'none'
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'iframe'
  return 'markdown'
}
