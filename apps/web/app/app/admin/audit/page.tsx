import type { Metadata } from 'next'
import AdminAuditView from '../../../../components/application/admin/AdminAuditView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('审计日志', '/app/admin/audit')
}

export default function AdminAuditPage() {
  return (
    <AppShell>
      <AdminAuditView />
    </AppShell>
  )
}