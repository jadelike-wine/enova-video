import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminUsersView from '@/components/application/admin/AdminUsersView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminUsers'), '/app/admin/users')
}

export default function AdminUsersPage() {
  return <AdminUsersView />
}