import type { Metadata } from 'next'
import AdminDashboardView from '../../../../components/application/admin/AdminDashboardView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export const metadata: Metadata = appMetadata('运营概览', '/app/admin/dashboard')

export default function AdminDashboardPage() {
  return (
    <AppShell>
      <AdminDashboardView />
    </AppShell>
  )
}