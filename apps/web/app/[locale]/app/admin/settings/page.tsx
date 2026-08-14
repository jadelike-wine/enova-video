import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminSettingsView from '@/components/application/AdminSettingsView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminSettings'), '/app/admin/settings')
}

export default function AdminSettingsPage() {
  return <AdminSettingsView />
}