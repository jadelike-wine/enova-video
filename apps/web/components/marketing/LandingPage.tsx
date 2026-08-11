import Link from 'next/link'
import MarketingLayout from './MarketingLayout'
import { FAQ, type FaqItem } from './FAQ'
import { getModelByApiId } from '../../lib/models'
import { faqJsonLd } from '../../lib/seo'

export interface LandingPageData {
  title: string
  subtitle: string
  intro: string[]
  features: { title: string; desc: string }[]
  modelSlider: string
  usageTitle: string
  usage: string[]
  faqs: FaqItem[]
  appHref: string
  appCta: string
  // model ids to highlight
  modelIds: string[]
}

export function LandingPage({ data }: { data: LandingPageData }) {
  const models = data.modelIds
    .map((id) => getModelByApiId(id))
    .filter((m) => m !== undefined)

  return (
    <MarketingLayout>
      {data.faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: faqJsonLd(data.faqs) }}
        />
      )}
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-14 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold leading-tight bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
          {data.title}
        </h1>
        <p className="mt-5 text-lg text-white/70 max-w-3xl mx-auto">{data.subtitle}</p>
        <div className="mt-8">
          <Link href={data.appHref} className="btn-primary text-base px-8 py-3">
            {data.appCta}
          </Link>
        </div>
      </section>

      {/* Intro */}
      <section className="max-w-3xl mx-auto px-6 py-6">
        <div className="space-y-4">
          {data.intro.map((p, i) => (
            <p key={i} className="text-white/70 leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-extrabold mb-8">主要能力</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.features.map((feature) => (
            <div key={feature.title} className="glass-card">
              <h3 className="font-bold text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Models */}
      {models.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12">
          <h2 className="text-2xl font-extrabold mb-6">{data.modelSlider}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {models.map((model) => (
              <Link
                key={model.slug}
                href={`/models/${model.slug}`}
                className="glass-card block group hover:border-white/30 transition-all duration-200"
              >
                <h3 className="font-bold text-white group-hover:text-cyan-300 transition-colors">
                  {model.name}
                </h3>
                <p className="text-sm text-white/60 mt-2">{model.tagline}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Usage */}
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-extrabold mb-6">{data.usageTitle}</h2>
        <ol className="space-y-4">
          {data.usage.map((step, i) => (
            <li key={i} className="glass-card flex gap-4">
              <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-400 flex items-center justify-center font-bold flex-shrink-0">
                {i + 1}
              </span>
              <p className="text-sm text-white/70 leading-relaxed pt-1">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-12">
        <FAQ items={data.faqs} />
      </section>
    </MarketingLayout>
  )
}