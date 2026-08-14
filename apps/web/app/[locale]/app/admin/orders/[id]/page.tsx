import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminOrderDetailView from '@/components/application/admin/AdminOrderDetailView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminOrderDetail'), '/app/admin/orders')
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminOrderDetailView orderId={id} />
}