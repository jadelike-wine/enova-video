import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminSystemUpdateView from '@/components/application/admin/AdminSystemUpdateView'
import { appMetadata } from '@/lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminSystemUpdate'), '/app/admin/system-update')
}

export default function AdminSystemUpdatePage() {
  return <AppShell><AdminSystemUpdateView /></AppShell>
}
