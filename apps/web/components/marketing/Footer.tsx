'use client'

import { useTranslations } from 'next-intl'
import { BRAND } from '../../lib/brand'

export default function MarketingFooter() {
  const t = useTranslations('home')
  return (
    <footer className="border-t border-[#E5E7EB] bg-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex justify-center">
          <div className="max-w-md text-center">
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center text-base font-extrabold text-white">
                {BRAND.logoMarkZh}
              </div>
              <span className="font-bold text-[#111827]">{BRAND.nameZh}</span>
            </div>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              {t('footerDescription')}
            </p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-[#E5E7EB] flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-gray-400">
          <p>© {new Date().getFullYear()} {BRAND.nameZh} · {BRAND.name}</p>
        </div>
      </div>
    </footer>
  )
}
