import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import WalletView from '@/components/application/WalletView'
import { appMetadata } from '@/lib/seo'
import AppShell from '../AppShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return appMetadata(t('pages.wallet'), '/app/wallet')
}

export default function WalletPage() {
  return (
    <AppShell>
      <WalletView />
    </AppShell>
  )
}