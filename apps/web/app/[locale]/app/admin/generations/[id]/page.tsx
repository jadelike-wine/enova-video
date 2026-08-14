import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminGenerationDetailView from '../../../../../components/application/admin/AdminGenerationDetailView'
import { appMetadata } from '../../../../../lib/seo'
import AppShell from '../../../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminGenerationDetail'), '/app/admin/generations')
}

export default async function AdminGenerationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <AppShell>
      <AdminGenerationDetailView jobId={id} />
    </AppShell>
  )
}