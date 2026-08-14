import type { Metadata } from 'next'
import AdminOrdersView from '../../../../components/application/admin/AdminOrdersView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('订单管理', '/app/admin/orders')
}

export default function AdminOrdersPage() {
  return (
    <AppShell>
      <AdminOrdersView />
    </AppShell>
  )
}