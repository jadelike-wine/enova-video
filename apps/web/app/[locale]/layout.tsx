import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import { buildFaviconIcons, getSiteLogo, getSiteUrl } from '@/lib/seo'
import { BRAND } from '@/lib/brand'
import { locales, type Locale } from '@/i18n.config'
import AntdProvider from '@/components/AntdProvider'

// 动态设置 dayjs locale
function initDayjsLocale(locale: string) {
  if (locale === 'en') {
    dayjs.locale('en')
  } else {
    dayjs.locale('zh-cn')
  }
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  const baseUrl = await getSiteUrl()
  const siteLogo = await getSiteLogo()
  const isZh = locale === 'zh-CN'
  const siteName = isZh ? BRAND.nameZh : BRAND.name
  const tagline = t('tagline')
  const description = t('description')

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: `${siteName} – ${tagline}`,
      template: `%s – ${siteName}`,
    },
    description,
    applicationName: siteName,
    authors: [{ name: siteName }],
    icons: buildFaviconIcons(siteLogo),
    openGraph: {
      siteName,
      type: 'website',
      locale: isZh ? 'zh_CN' : 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
    },
    alternates: {
      languages: {
        'zh-CN': `${baseUrl}/zh-CN`,
        en: `${baseUrl}/en`,
      },
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!locales.includes(locale as Locale)) {
    notFound()
  }

  // Enable static rendering
  setRequestLocale(locale)

  initDayjsLocale(locale)

  const messages = await getMessages()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AntdRegistry>
        <AntdProvider locale={locale}>{children}</AntdProvider>
      </AntdRegistry>
    </NextIntlClientProvider>
  )
}
