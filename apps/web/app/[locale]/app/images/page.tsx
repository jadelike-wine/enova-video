import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import ImageView from '@/components/application/ImageView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.images'), '/app/images')
}

export default function ImagesPage() {
  return <ImageView />
}