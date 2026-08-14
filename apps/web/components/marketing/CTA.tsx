'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

export function CTA() {
  const t = useTranslations('home')
  return (
    <section className="glass-card text-center py-12 px-6">
      <h2 className="text-2xl md:text-3xl font-bold mb-3 text-[#111827] tracking-tight">{t('ctaTitle')}</h2>
      <p className="text-[#6B7280] mb-8 max-w-2xl mx-auto">
        {t('ctaDescription')}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link href="/app/images" className="btn-primary">
          {t('ctaGenerateImage')}
        </Link>
        <Link href="/app/videos" className="btn-secondary">
          {t('ctaGenerateVideo')}
        </Link>
      </div>
    </section>
  )
}
