import type { Metadata } from 'next'
import AdminGenerationsView from '../../../../components/application/admin/AdminGenerationsView'
import { appMetadata } from '../../../../lib/seo'
import AppShell from '../../AppShell'

export const metadata: Metadata = appMetadata('生成任务', '/app/admin/generations')

export default function AdminGenerationsPage() {
  return (
    <AppShell>
      <AdminGenerationsView />
    </AppShell>
  )
}