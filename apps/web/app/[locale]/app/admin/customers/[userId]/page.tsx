import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminCustomer360View from '../../../../../components/application/admin/AdminCustomer360View'
import { appMetadata } from '../../../../../lib/seo'
import AppShell from '../../../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminCustomer360'), '/app/admin/customers')
}

export default async function AdminCustomer360Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  return (
    <AppShell>
      <AdminCustomer360View userId={userId} />
    </AppShell>
  )
}