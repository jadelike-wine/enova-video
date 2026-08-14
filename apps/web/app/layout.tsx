import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html className={inter.variable}>
      <body
        style={{ fontFamily: 'var(--font-inter), "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' }}
      >
        {children}
      </body>
    </html>
  )
}
