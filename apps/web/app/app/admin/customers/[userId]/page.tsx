import type { Metadata } from 'next'
import AdminCustomer360View from '../../../../../components/application/admin/AdminCustomer360View'
import { appMetadata } from '../../../../../lib/seo'
import AppShell from '../../../AppShell'

export const metadata: Metadata = appMetadata('客户 360', '/app/admin/customers')

export default async function AdminCustomer360Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  return (
    <AppShell>
      <AdminCustomer360View userId={userId} />
    </AppShell>
  )
}