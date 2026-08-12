import type { Metadata } from 'next'
import AdminGenerationDetailView from '../../../../../components/application/admin/AdminGenerationDetailView'
import { appMetadata } from '../../../../../lib/seo'
import AppShell from '../../../AppShell'

export const metadata: Metadata = appMetadata('任务详情', '/app/admin/generations')

export default async function AdminGenerationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <AppShell>
      <AdminGenerationDetailView jobId={id} />
    </AppShell>
  )
}