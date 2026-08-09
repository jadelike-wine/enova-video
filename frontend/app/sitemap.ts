import type { MetadataRoute } from 'next'
import { MODELS } from '../lib/models'

export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  const now = new Date()

  const staticRoutes = [
    { path: '/', priority: 1, changeFrequency: 'weekly' as const },
    { path: '/ai-chat', priority: 0.9, changeFrequency: 'weekly' as const },
    { path: '/ai-image-generator', priority: 0.9, changeFrequency: 'weekly' as const },
    { path: '/ai-video-generator', priority: 0.9, changeFrequency: 'weekly' as const },
    { path: '/models', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/docs/getting-started', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/docs/api-key', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/docs/image-generation', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/docs/video-generation', priority: 0.6, changeFrequency: 'monthly' as const },
  ]

  const modelRoutes = MODELS.map((m) => ({
    path: `/models/${m.slug}`,
    priority: 0.7,
    changeFrequency: 'monthly' as const,
  }))

  return [...staticRoutes, ...modelRoutes].map((route) => ({
    url: `${base}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}