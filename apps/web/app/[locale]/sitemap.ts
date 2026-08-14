import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getSiteUrl()
  const now = new Date()

  const staticRoutes = [
    { path: '/', priority: 1, changeFrequency: 'weekly' as const },
    { path: '/app/images', priority: 0.9, changeFrequency: 'weekly' as const },
    { path: '/app/videos', priority: 0.9, changeFrequency: 'weekly' as const },
  ]

  return staticRoutes.map((route) => ({
    url: `${base}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
