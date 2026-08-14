import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminAuditView from '@/components/application/admin/AdminAuditView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminAudit'), '/app/admin/audit')
}

export default function AdminAuditPage() {
  return <AdminAuditView />
}