import type { Metadata } from 'next'
import { BRAND } from './brand'

/**
 * Site identity.
 *
 * 站点 URL 优先从管理员后台「系统设置」的 `general.siteUrl` 读取（运行时 API 调用），
 * 管理员修改后立即生效，无需重新部署。如果数据库未配置则 fallback 到
 * 环境变量 `NEXT_PUBLIC_SITE_URL`（构建时注入），再 fallback 到 localhost。
 *
 * 站点当前为简体中文 UI，因此 SITE_NAME / SITE_TAGLINE 使用中文品牌「灵动创影」；
 * 英文/国际品牌名见 SITE_EN_NAME。
 */
export const SITE_NAME = BRAND.nameZh
export const SITE_EN_NAME = BRAND.name
export const SITE_TAGLINE = BRAND.taglineZh

/** 本地默认站点 URL（开发环境 fallback）。 */
const LOCALHOST_URL = 'http://localhost:3000'

/**
 * 从管理员后台「系统设置」获取站点 URL（运行时，异步）。
 * - 优先读取数据库中的 `general.siteUrl` 配置
 * - 如果数据库无配置，fallback 到 `NEXT_PUBLIC_SITE_URL` 环境变量
 * - 如果两者都不存在，使用 localhost（开发环境）
 *
 * 通过 Next.js rewrites，`/api/v1/public/site-config` 在服务端和客户端均可访问。
 */
export async function getSiteUrl(): Promise<string> {
  // 运行时：从后端 API 获取数据库配置的站点 URL。
  try {
    const resp = await fetch(
      `${process.env.BACKEND_URL || 'http://127.0.0.1:3001'}/api/v1/public/site-config`,
      { cache: 'no-store' },
    )
    if (resp.ok) {
      const data = (await resp.json()) as { siteUrl?: string }
      const url = data.siteUrl?.trim()
      if (url) return url.replace(/\/+$/, '')
    }
  } catch {
    // API 不可用时静默 fallback 到环境变量（如 SSG 构建期间）。
  }

  // Fallback: 环境变量（构建时注入）。
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  // 开发环境默认。
  return LOCALHOST_URL
}

/**
 * 构建绝对 URL（异步，运行时获取站点 URL）。
 * @param path - 路径，如 `/app/images`
 * @returns 完整 URL，如 `https://example.com/app/images`
 */
export async function absoluteUrl(path: string): Promise<string> {
  const base = await getSiteUrl()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

interface BuildMetadataOptions {
  title: string | { absolute: string }
  description: string
  path: string
  robots?: { index: boolean; follow: boolean }
}

/** Build consistent metadata for a given page (async, runtime site URL). */
export async function buildMetadata({
  title,
  description,
  path,
  robots = { index: true, follow: true },
}: BuildMetadataOptions): Promise<Metadata> {
  const canonical = await absoluteUrl(path)
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    robots: robots.index && robots.follow
      ? undefined
      : {
          index: robots.index,
          follow: robots.follow,
        },
  }
}

/** App-private pages: do not index or follow. */
export async function appMetadata(title: string, path: string): Promise<Metadata> {
  return buildMetadata({
    title,
    description: '灵动创影 应用页面',
    path,
    robots: { index: false, follow: false },
  })
}

/** FAQPage JSON-LD for pages that visibly render a FAQ section. */
export function faqJsonLd(items: { q: string; a: string }[]): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  })
}
