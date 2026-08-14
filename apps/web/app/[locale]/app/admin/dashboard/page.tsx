import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminDashboardView from '@/components/application/admin/AdminDashboardView'
import { appMetadata } from '@/lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminDashboard'), '/app/admin/dashboard')
}

export default function AdminDashboardPage() {
  return (
    <AppShell>
      <AdminDashboardView />
    </AppShell>
  )
}