'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { BRAND } from '../../lib/brand'
import LanguageSwitcher from '../LanguageSwitcher'

export default function MarketingHeader() {
  const t = useTranslations('navigation')
  return (
    <header
      className="sticky top-0 z-50 border-b border-[#E5E7EB]"
      style={{ background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(20px)' }}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center text-lg font-extrabold text-white">
            {BRAND.logoMarkZh}
          </div>
          <span className="font-bold text-lg text-[#111827]">{BRAND.nameZh}</span>
        </Link>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link href="/app/images" className="btn-primary text-sm px-5">
            {t('getStarted')}
          </Link>
        </div>
      </div>
    </header>
  )
}
