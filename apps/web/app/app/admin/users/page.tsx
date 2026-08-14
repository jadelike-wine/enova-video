import type { Metadata } from 'next'
import AdminUsersView from '../../../../components/application/admin/AdminUsersView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('用户管理', '/app/admin/users')
}

export default function AdminUsersPage() {
  return (
    <AppShell>
      <AdminUsersView />
    </AppShell>
  )
}