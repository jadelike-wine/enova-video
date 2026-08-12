'use client'

import Link from 'next/link'
import { type ReactNode } from 'react'

/** 日期格式化（本地时区 YYYY-MM-DD HH:mm）。 */
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 分转元字符串。 */
export function fmtMoney(cents: number | null | undefined, currency = 'CNY'): string {
  if (cents == null) return '—'
  return `${(cents / 100).toFixed(2)} ${currency}`
}

/** micro-USD 转字符串（保留 4 位小数，单位 USD）。 */
export function fmtMicrousd(usd: number | null | undefined): string {
  if (usd == null) return '—'
  return `$${(usd / 1_000_000).toFixed(4)}`
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'badge-completed',
  DISABLED: 'badge-failed',
  SUSPENDED: 'badge-failed',
  PENDING: 'badge-queued',
  QUEUED: 'badge-queued',
  RUNNING: 'badge-progress',
  RESERVED: 'badge-progress',
  SUCCEEDED: 'badge-completed',
  CAPTURED: 'badge-completed',
  RELEASED: 'badge-queued',
  FAILED: 'badge-failed',
  CANCELED: 'badge-failed',
  REFUNDED: 'badge-failed',
  DISPATCHED: 'badge-completed',
  SUPERSEDED: 'badge-failed',
  ACTIVE_OVERDUE: 'badge-failed',
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? '—'
  const cls = STATUS_STYLE[s.toUpperCase()] || 'badge'
  return <span className={`badge ${cls}`}>{s}</span>
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="font-bold text-white/90">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

export function PageHeader({ title, ...rest }: { title: string; [k: string]: unknown }) {
  return (
    <div className="p-5 border-b border-white/10">
      <h2 className="text-xl font-extrabold text-white">{title}</h2>
    </div>
  )
}

/** 表格容器：统一横向滚动 + 玻璃样式。 */
export function DataTable({
  headers,
  children,
}: {
  headers: string[]
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-white/50 text-xs uppercase tracking-wide">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">{children}</tbody>
      </table>
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <div className="py-10 text-center text-white/40 text-sm">{text}</div>
}

export function Loading({ text = '加载中…' }: { text?: string }) {
  return <div className="py-10 text-center text-white/50 text-sm animate-pulse">{text}</div>
}

export function AdminLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-cyan-300 hover:text-cyan-100 underline underline-offset-2">
      {children}
    </Link>
  )
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-xs text-white/50 hover:text-white/80">
      ← {label}
    </Link>
  )
}

export { Link }