import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SITE_NAME, SITE_TAGLINE, siteUrl } from '../lib/seo'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const baseUrl = siteUrl()

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: `${SITE_NAME} – ${SITE_TAGLINE}`,
    template: `%s – ${SITE_NAME}`,
  },
  description:
    'Agnes AI Creator 是一个基于 Agnes AI 免费模型的自托管多模态 AI Web 客户端，支持 AI 对话、AI 图片生成与 AI 视频生成。开源、可自部署。',
  applicationName: SITE_NAME,
  authors: [{ name: 'Agnes AI Creator' }],
  openGraph: {
    siteName: SITE_NAME,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}