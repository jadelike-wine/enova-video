import type { Metadata } from 'next'
import AdminSettingsView from '../../../../components/application/AdminSettingsView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export const metadata: Metadata = appMetadata('系统配置', '/app/admin/settings')

export default function AdminSettingsPage() {
  return (
    <AppShell>
      <AdminSettingsView />
    </AppShell>
  )
}