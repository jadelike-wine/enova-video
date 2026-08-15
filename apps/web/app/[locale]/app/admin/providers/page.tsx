import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminProvidersView from '@/components/application/admin/AdminProvidersView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminProviders'), '/app/admin/providers')
}

export default function AdminProvidersPage() {
  return <AdminProvidersView />
}
