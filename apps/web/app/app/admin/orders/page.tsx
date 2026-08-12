import type { Metadata } from 'next'
import AdminOrdersView from '../../../../components/application/admin/AdminOrdersView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export const metadata: Metadata = appMetadata('订单管理', '/app/admin/orders')

export default function AdminOrdersPage() {
  return (
    <AppShell>
      <AdminOrdersView />
    </AppShell>
  )
}