import type { Metadata } from 'next'
import ImageView from '../../../components/application/ImageView'
import { appMetadata } from '../../../lib/seo'
import AppShell from '../AppShell'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('AI 图片生成', '/app/images')
}

export default function ImagesPage() {
  return (
    <AppShell>
      <ImageView />
    </AppShell>
  )
}