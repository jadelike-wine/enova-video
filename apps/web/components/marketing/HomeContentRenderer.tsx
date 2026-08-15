'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from 'antd'
import { useSiteConfig, resolveHomeContent } from '@/lib/useSiteConfig'
import { BRAND } from '@/lib/brand'
import Link from 'next/link'

/**
 * 首页内容渲染器：
 * 优先级：自定义首页内容 > 简洁首页 > 默认首页（由父组件控制默认首页渲染）。
 *
 * - 内容以 http:// 或 https:// 开头 → iframe 渲染
 * - 其他内容 → Markdown/HTML 渲染
 * - 内容为空 → 返回 null（父组件渲染默认首页或简洁首页）
 */
export function HomeContentRenderer({
  children,
}: {
  children?: React.ReactNode
}) {
  const { config } = useSiteConfig()
  const [iframeLoading, setIframeLoading] = useState(true)
  const contentType = resolveHomeContent(config.homeContent)

  // 自定义首页内容优先
  if (contentType === 'iframe') {
    return (
      <div className="h-screen w-full overflow-hidden relative">
        {iframeLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <Skeleton active paragraph={{ rows: 4 }} />
          </div>
        )}
        <iframe
          src={config.homeContent.trim()}
          title="Home"
          className="w-full h-full border-0"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
          onLoad={() => setIframeLoading(false)}
        />
      </div>
    )
  }

  if (contentType === 'markdown') {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <MarkdownOrHtml content={config.homeContent} />
        </div>
      </div>
    )
  }

  // 没有自定义首页内容时，根据简洁首页开关决定渲染方式。
  if (config.compactHomeEnabled) {
    return <CompactHome />
  }

  // 默认首页：由父组件渲染
  return <>{children}</>
}

/**
 * 简洁站点信息页面。
 */
function CompactHome() {
  const { config } = useSiteConfig()
  const siteName = config.siteName || BRAND.nameZh
  const siteSubtitle = config.siteSubtitle || BRAND.taglineZh
  const logoUrl = config.siteLogo

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Logo */}
        <div className="flex justify-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={siteName} className="w-20 h-20 rounded-2xl object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-3xl font-extrabold text-white">
              {BRAND.logoMarkZh}
            </div>
          )}
        </div>

        {/* 站点名称和副标题 */}
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">{siteName}</h1>
          {siteSubtitle && (
            <p className="mt-2 text-lg text-gray-500">{siteSubtitle}</p>
          )}
        </div>

        {/* 进入按钮 */}
        <div className="pt-4">
          <Link
            href="/app/images"
            className="btn-primary inline-block text-base px-8"
            style={{ minHeight: 48, borderRadius: 12 }}
          >
            开始使用
          </Link>
        </div>

        {/* 客服联系方式 */}
        {config.contactInfo && (
          <p className="text-xs text-gray-400 pt-8">
            联系我们：{config.contactInfo}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Markdown / HTML 内容渲染器。
 * 安全处理：HTML 内容通过 DOMPurify 风格的清洗（简化版：移除 script 标签和危险属性）。
 *
 * 注意：为了安全，我们使用 dangerouslySetInnerHTML 时进行基本的 XSS 防护。
 * 生产环境建议使用 DOMPurify 库做更全面的清洗。
 */
function MarkdownOrHtml({ content }: { content: string }) {
  const [processedContent, setProcessedContent] = useState('')

  useEffect(() => {
    // 基本安全处理：移除 <script> 标签和 on* 事件属性
    const sanitized = sanitizeHtml(content)
    setProcessedContent(sanitized)
  }, [content])

  // 如果内容看起来像 HTML（包含标签），用 dangerouslySetInnerHTML 渲染。
  // 否则当作纯文本/Markdown 简单渲染（保留换行）。
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(content)

  if (looksLikeHtml) {
    return (
      <div
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: processedContent }}
      />
    )
  }

  // 简单 Markdown 文本渲染：保留换行和基本格式
  return (
    <div className="prose prose-sm max-w-none whitespace-pre-wrap">
      {content}
    </div>
  )
}

/**
 * 基本 HTML 安全清洗：移除 <script>、on* 事件处理器、javascript: 协议。
 * 这不是完整的 XSS 防护方案，但提供了基本的防护层。
 * 参考 sub2api 的做法：在后端和前端均进行基本的 HTML 清洗。
 */
function sanitizeHtml(html: string): string {
  return html
    // 移除 <script>...</script> 标签
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // 移除 on* 事件属性
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    // 移除 javascript: 协议
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, '')
    .replace(/src\s*=\s*"javascript:[^"]*"/gi, '')
    // 移除 <iframe> 标签（防止嵌套 iframe）
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
}
