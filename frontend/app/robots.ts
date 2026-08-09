import type { MetadataRoute } from 'next'

export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/ai-chat', '/ai-image-generator', '/ai-video-generator', '/models', '/docs'],
        disallow: ['/app/', '/api/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}