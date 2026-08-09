import type { Metadata } from 'next'
import ImageView from '../../../components/application/ImageView'
import { appMetadata } from '../../../lib/seo'

export const metadata: Metadata = appMetadata('AI 图片生成', '/app/images')

export default function ImagesPage() {
  return <ImageView />
}