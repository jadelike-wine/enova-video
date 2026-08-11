import type { Metadata } from 'next'
import WalletView from '../../../components/application/WalletView'
import { appMetadata } from '../../../lib/seo'
import AppShell from '../AppShell'

export const metadata: Metadata = appMetadata('钱包', '/app/wallet')

export default function WalletPage() {
  return (
    <AppShell>
      <WalletView />
    </AppShell>
  )
}