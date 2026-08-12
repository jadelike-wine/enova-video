import type { Metadata } from 'next'
import AdminOrderDetailView from '../../../../../components/application/admin/AdminOrderDetailView'
import { appMetadata } from '../../../../../lib/seo'
import AppShell from '../../../AppShell'

export const metadata: Metadata = appMetadata('订单详情', '/app/admin/orders')

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <AppShell>
      <AdminOrderDetailView orderId={id} />
    </AppShell>
  )
}