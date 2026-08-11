import type { Metadata } from 'next'
import VideoView from '../../../components/application/VideoView'
import { appMetadata } from '../../../lib/seo'
import AppShell from '../AppShell'

export const metadata: Metadata = appMetadata('AI 视频生成', '/app/videos')

export default function VideosPage() {
  return (
    <AppShell>
      <VideoView />
    </AppShell>
  )
}