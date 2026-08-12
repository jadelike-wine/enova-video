'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminOrdersApi, type AdminOrderView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { AdminLink, Card, DataTable, EmptyState, Loading, PageHeader, StatusBadge, fmtDate, fmtMoney } from './AdminUi'

const PAGE_SIZE = 50
const STATUS_OPTIONS = ['', 'PENDING', 'SUCCEEDED', 'FAILED']
const TYPE_OPTIONS = ['', 'RECHARGE', 'PLAN', 'CREDIT_PACK']

export default function AdminOrdersView() {
  const { alert } = useDialog()
  const [orders, setOrders] = useState<AdminOrderView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState('')
  const [orderType, setOrderType] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await adminOrdersApi.list({
        limit: PAGE_SIZE,
        offset,
        status: status || undefined,
        orderType: orderType || undefined,
      })
      setOrders(rows)
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [offset, status, orderType, alert])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="订单管理" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <select className="input-field" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0) }}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s ? `状态：${s}` : '全部状态'}</option>
            ))}
          </select>
          <select className="input-field" value={orderType} onChange={(e) => { setOrderType(e.target.value); setOffset(0) }}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t ? `类型：${t}` : '全部类型'}</option>
            ))}
          </select>
        </div>

        <Card>
          {loading ? (
            <Loading />
          ) : orders.length === 0 ? (
            <EmptyState text="没有订单" />
          ) : (
            <DataTable
              headers={['订单', '用户', '类型', '金额', '状态', '履约', 'Credits', '创建时间', '操作']}
            >
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-white/5">
                  <td className="px-3 py-2 text-white/60">{o.id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-white/60">{o.userId.slice(0, 8)}</td>
                  <td className="px-3 py-2">{o.orderType}</td>
                  <td className="px-3 py-2">{fmtMoney(o.amountCents, o.currency)}</td>
                  <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-3 py-2"><StatusBadge status={o.fulfillmentStatus} /></td>
                  <td className="px-3 py-2">{o.credits}</td>
                  <td className="px-3 py-2 text-white/50">{fmtDate(o.createdAt)}</td>
                  <td className="px-3 py-2">
                    <AdminLink href={`/app/admin/orders/${o.id}`}>详情</AdminLink>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <div className="flex items-center justify-between pt-3">
            <button className="btn-ghost text-xs" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              上一页
            </button>
            <span className="text-xs text-white/40">offset {offset}</span>
            <button className="btn-ghost text-xs" disabled={orders.length < PAGE_SIZE || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
              下一页
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}