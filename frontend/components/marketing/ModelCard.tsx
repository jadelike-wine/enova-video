import { MODELS, type ModelInfo } from '../../lib/models'

export function ModelCard({ model }: { model: ModelInfo }) {
  const kindLabel: Record<string, string> = {
    text: '文本',
    image: '图片',
    video: '视频',
  }
  const kindClass: Record<string, string> = {
    text: 'bg-violet-400/15 text-violet-200 border-violet-400/25',
    image: 'bg-pink-400/15 text-pink-200 border-pink-400/25',
    video: 'bg-cyan-400/15 text-cyan-200 border-cyan-400/25',
  }
  return (
    <a
      href={`/models/${model.slug}`}
      className="glass-card block group hover:border-white/30 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-bold text-white group-hover:text-cyan-300 transition-colors">
          {model.name}
        </h3>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${kindClass[model.kind]}`}
        >
          {kindLabel[model.kind]}
        </span>
      </div>
      <p className="text-sm text-white/60 mb-3">{model.tagline}</p>
      <div className="flex flex-wrap gap-1.5">
        {model.capabilities.slice(0, 3).map((cap) => (
          <span
            key={cap}
            className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-white/50"
          >
            {cap}
          </span>
        ))}
      </div>
    </a>
  )
}

export function ModelGrid() {
  const active = MODELS.filter((m) => !m.deprecated)
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {active.map((model) => (
        <ModelCard key={model.slug} model={model} />
      ))}
    </div>
  )
}