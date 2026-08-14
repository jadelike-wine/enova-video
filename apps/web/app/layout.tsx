import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SITE_NAME, SITE_TAGLINE, getSiteUrl } from '../lib/seo'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = await getSiteUrl()
  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: `${SITE_NAME} – ${SITE_TAGLINE}`,
      template: `%s – ${SITE_NAME}`,
    },
    description:
      '灵动创影（EnovaMotion）是一个 AI 智能创作平台，提供 AI 图片生成与 AI 视频生成能力。',
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME }],
    openGraph: {
      siteName: SITE_NAME,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
    },
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body
        style={{ fontFamily: 'var(--font-inter), "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' }}
      >
        {children}
      </body>
    </html>
  )
}
