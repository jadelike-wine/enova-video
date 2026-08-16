import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminPricingView from '@/components/application/admin/AdminPricingView'
import { appMetadata } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminPricing'), '/app/admin/pricing')
}

export default function AdminPricingPage() {
  return <AdminPricingView />
}
