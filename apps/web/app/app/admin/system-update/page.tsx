import type { Metadata } from 'next'
import AdminSystemUpdateView from '../../../../components/application/AdminSystemUpdateView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('系统更新', '/app/admin/system-update')
}

export default function AdminSystemUpdatePage() {
  return <AppShell><AdminSystemUpdateView /></AppShell>
}
