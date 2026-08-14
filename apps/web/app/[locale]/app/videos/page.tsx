import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import VideoView from '@/components/application/VideoView'
import { appMetadata } from '@/lib/seo'
import AppShell from '../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.videos'), '/app/videos')
}

export default function VideosPage() {
  return (
    <AppShell>
      <VideoView />
    </AppShell>
  )
}