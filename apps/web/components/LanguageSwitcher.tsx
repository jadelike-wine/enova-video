'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n.config'
import { useState, useRef, useEffect } from 'react'
import { locales, localeShortNames, type Locale } from '@/i18n.config'

export default function LanguageSwitcher() {
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const switchTo = (nextLocale: Locale) => {
    if (nextLocale === locale) {
      setOpen(false)
      return
    }
    // next-intl navigation: useRouter().replace 保持 pathname 不变，只替换 locale
    router.replace(pathname, { locale: nextLocale })
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
        aria-label="Language switcher"
      >
        <span>🌐</span>
        <span>{localeShortNames[locale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-36 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden z-50">
          {locales.map((l) => (
            <button
              key={l}
              onClick={() => switchTo(l)}
              className={`flex items-center justify-between w-full px-4 py-2 text-sm transition-colors ${
                l === locale
                  ? 'text-[#7C3AED] bg-[#7C3AED]/5 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>{localeShortNames[l]}</span>
              {l === locale && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
