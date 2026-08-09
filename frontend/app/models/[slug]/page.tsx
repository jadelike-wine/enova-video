import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import MarketingLayout from '../../../components/marketing/MarketingLayout'
import { MODELS, getModelBySlug, type ModelInfo } from '../../../lib/models'
import { buildMetadata } from '../../../lib/seo'

interface Props {
  params: Promise<{ slug: string }>
}

const kindLabel: Record<string, string> = { text: '文本', image: '图片', video: '视频' }

const appPathFor = (kind: ModelInfo['kind']): string => {
  if (kind === 'text') return '/app/chat'
  if (kind === 'image') return '/app/images'
  return '/app/videos'
}

export async function generateStaticParams() {
  return MODELS.map((m) => ({ slug: m.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const model = getModelBySlug(slug)
  if (!model) return {}
  return buildMetadata({
    title: model.name,
    description: model.description,
    path: `/models/${model.slug}`,
  })
}

export default async function ModelDetailPage({ params }: Props) {
  const { slug } = await params
  const model = getModelBySlug(slug)
  if (!model) notFound()

  const related = MODELS.filter((m) => m.kind === model.kind && m.slug !== model.slug)

  return (
    <MarketingLayout>
      <article className="max-w-4xl mx-auto px-6 py-16">
        <nav aria-label="面包屑" className="text-sm text-white/50 mb-6">
          <Link href="/" className="hover:text-cyan-300">{' '}首页{' '}</Link>
          <span className="mx-1">/</span>
          <Link href="/models" className="hover:text-cyan-300">{' '}模型{' '}</Link>
          <span className="mx-1">/</span>
          <span className="text-white/70">{model.name}</span>
        </nav>

        <header>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-4xl font-extrabold bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
              {model.name}
            </h1>
            <span className="badge-progress">{kindLabel[model.kind]}模型</span>
            {model.deprecated && <span className="badge-failed">已弃用</span>}
          </div>
          <p className="mt-4 text-white/70 text-lg">{model.tagline}</p>
        </header>

        <section className="mt-8">
          <h2 className="text-xl font-bold mb-3">简介</h2>
          <p className="text-white/70 leading-relaxed">{model.description}</p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold mb-3">能力</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {model.capabilities.map((cap) => (
              <li key={cap} className="glass flex items-center gap-2 px-4 py-2.5 text-sm text-white/80">
                <span className="text-cyan-300">✓</span>
                {cap}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold mb-3">技术信息</h2>
          <dl className="glass p-5 rounded-3xl space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-white/50">模型 ID</dt>
              <dd className="text-white/80 font-mono">{model.apiId}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/50">类型</dt>
              <dd className="text-white/80">{kindLabel[model.kind]}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-10">
          <Link href={appPathFor(model.kind)} className="btn-primary text-base px-8 py-3">
            立即使用 {model.name}
          </Link>
        </section>

        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="text-xl font-bold mb-4">相关模型</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {related.map((m) => (
                <Link
                  key={m.slug}
                  href={`/models/${m.slug}`}
                  className="glass-card block hover:border-white/30 transition-all duration-200"
                >
                  <h3 className="font-bold text-white">{m.name}</h3>
                  <p className="text-sm text-white/60 mt-1">{m.tagline}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>
    </MarketingLayout>
  )
}