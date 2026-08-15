'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Skeleton } from 'antd'
import { useSiteConfig } from '@/lib/useSiteConfig'
import { useSession } from '@/lib/auth'
import type { CustomMenuItem } from '@/lib/api'

/**
 * 自定义菜单页面：通过 iframe 嵌入配置的外部 URL。
 * 路由 /app/custom/[menuId] 根据菜单 ID 查找对应 URL。
 */
export default function CustomMenuPage() {
  const params = useParams<{ menuId: string }>()
  const { config, loading } = useSiteConfig()
  const { user } = useSession()
  const [menuItem, setMenuItem] = useState<CustomMenuItem | null>(null)
  const [iframeLoading, setIframeLoading] = useState(true)

  useEffect(() => {
    if (loading || !params?.menuId) return
    const item = config.customMenuItems.find((m) => m.id === params.menuId)
    if (!item) return
    // 权限校验：普通用户不能访问仅管理员可见的页面。
    if (item.visibility === 'admin' && user?.role !== 'ADMIN') {
      setMenuItem(null)
      return
    }
    setMenuItem(item)
  }, [params, config, loading, user])

  if (loading) {
    return (
      <div className="h-full p-8">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    )
  }

  if (!menuItem) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">页面不存在或无权访问</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-4 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-900">{menuItem.label}</h2>
      </header>
      <div className="flex-1 overflow-hidden relative">
        {iframeLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <Skeleton active paragraph={{ rows: 4 }} />
          </div>
        )}
        <iframe
          src={menuItem.url}
          title={menuItem.label}
          className="w-full h-full border-0"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
          onLoad={() => setIframeLoading(false)}
        />
      </div>
    </div>
  )
}
