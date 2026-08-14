import type { Metadata } from 'next'
import { appMetadata } from '../../lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  return appMetadata('认证', '/auth')
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}