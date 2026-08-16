import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import GenerationHistory from '@/components/application/GenerationHistory'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.images'), '/app/images/history')
}

export default function ImageHistoryPage() {
  return <GenerationHistory type="image" />
}
