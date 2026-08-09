import type { Metadata } from 'next'
import SettingsView from '../../../components/application/SettingsView'
import { appMetadata } from '../../../lib/seo'

export const metadata: Metadata = appMetadata('设置', '/app/settings')

export default function SettingsPage() {
  return <SettingsView />
}