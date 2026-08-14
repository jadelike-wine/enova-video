import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminOrdersView from '@/components/application/admin/AdminOrdersView'
import { appMetadata } from '@/lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminOrders'), '/app/admin/orders')
}

export default function AdminOrdersPage() {
  return (
    <AppShell>
      <AdminOrdersView />
    </AppShell>
  )
}