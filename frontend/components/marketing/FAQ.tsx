export interface FaqItem {
  q: string
  a: string
}

export function FAQ({ items }: { items: FaqItem[] }) {
  return (
    <section>
      <h2 className="text-2xl font-extrabold mb-6">常见问题</h2>
      <div className="space-y-4">
        {items.map((item, i) => (
          <details
            key={i}
            className="glass-card group"
            open={i === 0}
          >
            <summary className="font-semibold text-white cursor-pointer list-none flex items-center justify-between gap-3">
              {item.q}
              <span className="text-white/40 group-open:rotate-45 transition-transform text-xl leading-none">
                +
              </span>
            </summary>
            <p className="text-sm text-white/60 mt-3 leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}