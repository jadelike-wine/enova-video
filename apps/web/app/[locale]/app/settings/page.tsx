import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import SettingsView from '@/components/application/SettingsView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.settings'), '/app/settings')
}

export default function SettingsPage() {
  return <SettingsView />
}