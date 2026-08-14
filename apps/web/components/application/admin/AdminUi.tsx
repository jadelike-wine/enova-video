'use client'

import Link from 'next/link'
import { Button, Card as AntdCard, Empty, Skeleton, Tag } from 'antd'
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

const STATUS_TAG_COLOR: Record<string, string> = {
  ACTIVE: 'success',
  DISABLED: 'error',
  SUSPENDED: 'error',
  PENDING: 'processing',
  QUEUED: 'processing',
  RUNNING: 'processing',
  RESERVED: 'processing',
  SUCCEEDED: 'success',
  CAPTURED: 'success',
  RELEASED: 'processing',
  FAILED: 'error',
  CANCELED: 'error',
  REFUNDED: 'error',
  DISPATCHED: 'success',
  SUPERSEDED: 'error',
  ACTIVE_OVERDUE: 'error',
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? '—'
  const color = STATUS_TAG_COLOR[s.toUpperCase()] || 'default'
  return <Tag color={color}>{s}</Tag>
}

/** 兼容包装：使用 antd Card 组件。 */
export function CardWrapper({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <AntdCard title={title} extra={action} className="!rounded-2xl">
      {children}
    </AntdCard>
  )
}

// Keep old name for backward compat
export const Card = CardWrapper

export function PageHeader({ title }: { title: string }) {
  return (
    <div className="p-5 border-b border-gray-200">
      <h2 className="text-xl font-bold text-gray-900">{title}</h2>
    </div>
  )
}

/** 表格容器：保留兼容性，但内部使用 antd Card 包裹 */
export function EmptyState({ text }: { text: string }) {
  return <Empty description={text} />
}

export function Loading({ text = '加载中…' }: { text?: string }) {
  return <Skeleton active paragraph={{ rows: 3 }} />
}

export function AdminLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-[#7C3AED] hover:text-[#6D28D9] underline underline-offset-2">
      {children}
    </Link>
  )
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href}>
      <Button type="link" size="small" className="!px-0 !text-gray-500 hover:!text-gray-900">
        ← {label}
      </Button>
    </Link>
  )
}

export { Link, Button }
