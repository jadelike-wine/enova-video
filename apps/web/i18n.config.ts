import { defineRouting } from 'next-intl/routing'
import { createNavigation } from 'next-intl/navigation'

export const locales = ['zh-CN', 'en'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'zh-CN'

export const localeNames: Record<Locale, string> = {
  'zh-CN': '中文',
  en: 'English',
}

export const localeShortNames: Record<Locale, string> = {
  'zh-CN': '中文',
  en: 'EN',
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
})

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
