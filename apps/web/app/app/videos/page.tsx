import type { Metadata } from 'next'
import VideoView from '../../../components/application/VideoView'
import { appMetadata } from '../../../lib/seo'
import AppShell from '../AppShell'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('AI 视频生成', '/app/videos')
}

export default function VideosPage() {
  return (
    <AppShell>
      <VideoView />
    </AppShell>
  )
}