import { getTranslations, setRequestLocale } from 'next-intl/server'
import Link from 'next/link'
import { BRAND } from '@/lib/brand'
import MarketingLayout from '@/components/marketing/MarketingLayout'
import { SiteConfigProvider } from '@/lib/useSiteConfig'
import { HomeContentRenderer } from '@/components/marketing/HomeContentRenderer'

export async function generateMetadata() {
  const t = await getTranslations('metadata')
  return {
    title: { absolute: `${BRAND.nameZh} – ${BRAND.taglineZh}` },
    description: t('homeDescription'),
  }
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('home')

  const features = [
    {
      href: '/app/images',
      title: t('featureImageTitle'),
      desc: t('featureImageDesc'),
      icon: '🎨',
      iconBg: 'bg-sky-100',
    },
    {
      href: '/app/videos',
      title: t('featureVideoTitle'),
      desc: t('featureVideoDesc'),
      icon: '🎬',
      iconBg: 'bg-orange-100',
    },
  ]

  return (
    <SiteConfigProvider>
      <HomeContentRenderer>
        <MarketingLayout>
          {/* Hero */}
          <section className="bg-white">
            <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium text-[#0d9488] bg-[#0d9488]/10 border border-[#0d9488]/20 mb-6">
                ✨ {BRAND.taglineEn}
              </span>
              <h1 className="text-4xl md:text-6xl font-bold leading-tight text-[#111827] tracking-tight">
                {t('heroTitle')}
              </h1>
              <p className="mt-6 text-lg text-[#6B7280] max-w-3xl mx-auto leading-relaxed">
                {t('heroDescription')}
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/app/images"
                  className="btn-primary text-base px-8"
                  style={{ minHeight: 48, borderRadius: 12 }}
                >
                  {t('startCreating')}
                </Link>
                <Link
                  href="/app/videos"
                  className="btn-secondary text-base px-8"
                  style={{ minHeight: 48, borderRadius: 12 }}
                >
                  {t('generateVideo')}
                </Link>
              </div>
            </div>
          </section>

          {/* Features */}
          <section className="bg-[#F9FAFB]">
            <div className="max-w-6xl mx-auto px-6 py-20">
              <h2 className="text-2xl md:text-3xl font-bold text-[#111827] mb-3 text-center tracking-tight">{t('featuresTitle')}</h2>
              <p className="text-[#6B7280] text-center mb-12">{t('featuresSubtitle')}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                {features.map((feature) => (
                  <Link
                    key={feature.title}
                    href={feature.href}
                    className="group bg-white rounded-2xl p-6 border border-[#E5E7EB] transition-all duration-300 hover:-translate-y-1"
                    style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)' }}
                  >
                    <div
                      className={`w-14 h-14 rounded-full ${feature.iconBg} flex items-center justify-center text-2xl mb-5`}
                    >
                      {feature.icon}
                    </div>
                    <h3 className="text-lg font-bold text-[#111827] mb-2 group-hover:text-[#0d9488] transition-colors">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-[#6B7280] leading-relaxed">{feature.desc}</p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </MarketingLayout>
      </HomeContentRenderer>
    </SiteConfigProvider>
  )
}
