import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import AdminGenerationsView from '@/components/application/admin/AdminGenerationsView'
import { appMetadata } from '@/lib/seo'
import AppShell from '../../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.adminGenerations'), '/app/admin/generations')
}

export default function AdminGenerationsPage() {
  return (
    <AppShell>
      <AdminGenerationsView />
    </AppShell>
  )
}