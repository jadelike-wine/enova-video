import type { Metadata } from 'next'

/**
 * Site identity. Update NEXT_PUBLIC_SITE_URL in production.
 * Falls back to localhost in development.
 */
export const SITE_NAME = 'Agnes AI Creator'
export const SITE_TAGLINE = 'Open Source AI Chat, Image & Video Generator'

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()

  if (configured) {
    return configured.replace(/\/+$/, '')
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL is required in production')
  }

  return 'http://localhost:3000'
}

export function absoluteUrl(path: string): string {
  const base = siteUrl()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

interface BuildMetadataOptions {
  title: string | { absolute: string }
  description: string
  path: string
  robots?: { index: boolean; follow: boolean }
}

/** Build consistent metadata for a given page. */
export function buildMetadata({
  title,
  description,
  path,
  robots = { index: true, follow: true },
}: BuildMetadataOptions): Metadata {
  const canonical = absoluteUrl(path)
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
export function appMetadata(title: string, path: string): Metadata {
  return buildMetadata({
    title,
    description: 'Agnes AI Creator 应用页面',
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