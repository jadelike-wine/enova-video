import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BRAND } from '../../../lib/brand'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return {
    title: { absolute: `${t('pages.auth')} – ${BRAND.name}` },
    description: t('appPage'),
    robots: { index: false, follow: false },
  }
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
