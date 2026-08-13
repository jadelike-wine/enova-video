'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminOrdersApi, type AdminOrderDetailView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { BackLink, Card, DataTable, EmptyState, Loading, StatusBadge, fmtDate, fmtMoney } from './AdminUi'

export default function AdminOrderDetailView({ orderId }: { orderId: string }) {
  const { alert, confirm } = useDialog()
  const [order, setOrder] = useState<AdminOrderDetailView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrder(await adminOrdersApi.detail(orderId))
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [orderId, alert])

  useEffect(() => {
    void load()
  }, [load])

  const retryFulfillment = async () => {
    const ok = await confirm({
      title: '重试履约',
      message: '确定要重试该订单的履约吗？操作幂等，不会重复发放权益。',
    })
    if (!ok) return
    setBusy(true)
    try {
      await adminOrdersApi.retryFulfillment(orderId)
      await load()
      await alert({ title: '已完成', message: '履约已重试' })
    } catch (e) {
      await alert({ title: '重试失败', message: formatErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const closeOrder = async () => {
    const ok = await confirm({
      title: '关闭订单',
      message: '确定要关闭该未支付订单吗？',
      confirmVariant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      await adminOrdersApi.close(orderId)
      await load()
      await alert({ title: '已关闭', message: '订单已关闭' })
    } catch (e) {
      await alert({ title: '关闭失败', message: formatErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (!order) return <EmptyState text="订单不存在" />

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 pb-2">
        <BackLink href="/app/admin/orders" label="返回订单列表" />
        <h2 className="text-xl font-extrabold text-gray-900 mt-2">订单详情</h2>
        <p className="text-sm text-gray-500">{order.id}</p>
      </div>

      <div className="p-5 space-y-5">
        <Card title="基本信息">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div><p className="text-gray-500">类型</p><p className="font-bold text-gray-900">{order.orderType}</p></div>
            <div><p className="text-gray-500">金额</p><p className="font-bold text-gray-900">{fmtMoney(order.amountCents, order.currency)}</p></div>
            <div><p className="text-gray-500">Credits</p><p className="font-bold text-gray-900">{order.credits}</p></div>
            <div><p className="text-gray-500">状态</p><p className="font-bold text-gray-900"><StatusBadge status={order.status} /></p></div>
            <div><p className="text-gray-500">履约</p><p className="font-bold text-gray-900"><StatusBadge status={order.fulfillmentStatus} /></p></div>
            <div><p className="text-gray-500">用户</p><p className="font-bold text-gray-900">{order.userId.slice(0, 8)}</p></div>
            <div><p className="text-gray-500">Workspace</p><p className="font-bold text-gray-900">{order.workspaceId.slice(0, 8)}</p></div>
            <div><p className="text-gray-500">创建时间</p><p className="font-bold text-gray-900">{fmtDate(order.createdAt)}</p></div>
          </div>
          {order.snapshotJson && (
            <pre className="mt-3 bg-gray-100 rounded-xl p-3 text-xs text-gray-800 overflow-x-auto">
              {JSON.stringify(order.snapshotJson, null, 2)}
            </pre>
          )}
        </Card>

        <Card
          title="支付交易"
          action={
            <div className="flex gap-2">
              {order.status === 'SUCCEEDED' && order.fulfillmentStatus !== 'SUCCEEDED' && (
                <button className="btn-secondary text-xs" disabled={busy} onClick={() => void retryFulfillment()}>
                  重试履约
                </button>
              )}
              {order.status === 'PENDING' && (
                <button className="btn-danger text-xs" disabled={busy} onClick={() => void closeOrder()}>
                  关闭订单
                </button>
              )}
            </div>
          }
        >
          {order.paymentTransactions.length === 0 ? (
            <EmptyState text="无支付记录" />
          ) : (
            <DataTable headers={['Provider', 'Provider Ref', '状态', '时间']}>
              {order.paymentTransactions.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2">{t.provider}</td>
                  <td className="px-3 py-2 text-gray-600">{t.providerRef ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                  <td className="px-3 py-2 text-gray-500">—</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        <Card title="履约信息">
          {order.fulfillment ? (
            <div className="text-sm text-gray-700 space-y-1">
              <p>状态：<StatusBadge status={order.fulfillment.status} /></p>
              <p>订阅：{order.fulfillment.subscriptionId ?? '—'}</p>
              <p>发放 Credits：{order.fulfillment.creditsGranted}</p>
              <p>错误：{order.fulfillment.errorMessage ?? '—'}</p>
              <p>完成时间：{fmtDate(order.fulfillment.completedAt)}</p>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">无履约记录</p>
          )}
        </Card>

        <Card title="钱包账本">
          {order.ledger.length === 0 ? (
            <EmptyState text="无账本记录" />
          ) : (
            <DataTable headers={['类型', '金额', '余额', '描述', '时间']}>
              {order.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2"><StatusBadge status={l.type} /></td>
                  <td className="px-3 py-2">{l.amount}</td>
                  <td className="px-3 py-2 text-gray-600">{l.balanceAfter}</td>
                  <td className="px-3 py-2 text-gray-500">{l.description ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtDate(l.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </div>
  )
}