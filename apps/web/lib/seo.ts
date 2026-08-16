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

/**
 * 从管理员后台「系统设置」获取站点 Logo（运行时，异步）。
 *
 * 与 `getSiteUrl()` 同源，都通过 `/api/v1/public/site-config` 获取。
 * 后台配置的 `general.siteLogo` 可能是：
 * - 远程图片 URL（`https://...` / `http://...`）
 * - base64 data URI（`data:image/png;base64,...`）
 * - 空字符串（未配置）
 *
 * @returns 站点 Logo URL 或 data URI；未配置时返回空字符串。
 */
export async function getSiteLogo(): Promise<string> {
  try {
    const resp = await fetch(
      `${process.env.BACKEND_URL || 'http://127.0.0.1:3001'}/api/v1/public/site-config`,
      { cache: 'no-store' },
    )
    if (resp.ok) {
      const data = (await resp.json()) as { siteLogo?: string }
      return data.siteLogo?.trim() ?? ''
    }
  } catch {
    // API 不可用时静默返回空字符串（使用默认 favicon fallback）。
  }
  return ''
}

/**
 * 判断 Logo 值是否可直接用作 favicon `href`。
 *
 * 浏览器 `<link rel="icon">` 支持的图片格式有限：
 * - ICO / PNG / GIF / SVG（现代浏览器支持）
 * - base64 data URI（`data:image/png;base64,...` 等）
 * - 远程 http(s) URL
 *
 * 后台允许上传 PNG / JPG / SVG。JPG 虽然不是所有浏览器作为 favicon
 * 的首选格式，但现代 Chrome / Firefox / Safari 都能显示 JPG favicon。
 * 因此直接复用 `siteLogo` 即可，无需单独的 favicon 配置。
 */
function isUsableAsFavicon(logo: string): boolean {
  if (!logo) return false
  // data URI 或 http(s) URL
  return /^data:image\//i.test(logo) || /^https?:\/\//i.test(logo)
}

/**
 * 构建 favicon icons metadata。
 *
 * - 如果后台配置了 `general.siteLogo` 且格式可用，则用作 favicon。
 * - 附带时间戳 query 参数作为 cache buster，确保管理员更新 Logo 后
 *   浏览器能获取新图标（避免浏览器长期强缓存旧 favicon）。
 * - 未配置 Logo 时返回 `undefined`，由 Next.js 默认 `/favicon.ico` fallback。
 *
 * @param logo - 站点 Logo URL 或 data URI（来自后台配置）
 * @returns Next.js Metadata.icons 对象，或 undefined
 */
export function buildFaviconIcons(logo: string): Metadata['icons'] {
  if (!isUsableAsFavicon(logo)) return undefined

  // data URI 不需要 cache busting（内容本身即唯一标识）。
  if (logo.startsWith('data:')) {
    return { icon: [{ url: logo }] }
  }

  // 远程 URL：附加时间戳 query 参数，确保管理员更换 Logo 后浏览器重新拉取。
  const separator = logo.includes('?') ? '&' : '?'
  const versionedUrl = `${logo}${separator}v=${Date.now()}`

  return {
    icon: [{ url: versionedUrl }],
  }
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
    description: 'EnovaMotion App',
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
