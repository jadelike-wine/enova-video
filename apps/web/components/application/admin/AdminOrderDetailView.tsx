'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Descriptions, Skeleton, Table } from 'antd'
import type { TableProps } from 'antd'
import { adminOrdersApi, type AdminOrderDetailView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { BackLink, PageHeader, StatusBadge, fmtDate, fmtMoney } from './AdminUi'

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

  if (loading) return (
    <div className="p-5">
      <Skeleton active paragraph={{ rows: 8 }} />
    </div>
  )
  if (!order) return <div className="p-10 text-center text-gray-400">订单不存在</div>

  type TxnItem = AdminOrderDetailView['paymentTransactions'][number]

  const txnColumns: TableProps<TxnItem>['columns'] = [
    { title: 'Provider', dataIndex: 'provider', key: 'provider' },
    { title: 'Provider Ref', dataIndex: 'providerRef', key: 'providerRef', render: (v?: string) => <span className="text-gray-600">{v ?? '—'}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: '时间', key: 'time', render: () => <span className="text-gray-500">—</span> },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 pb-2">
        <BackLink href="/app/admin/orders" label="返回订单列表" />
        <PageHeader title="订单详情" />
        <p className="text-sm text-gray-500">{order.id}</p>
      </div>

      <div className="p-5 space-y-5">
        <Card title="基本信息">
          <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
            <Descriptions.Item label="类型">{order.orderType}</Descriptions.Item>
            <Descriptions.Item label="金额">{fmtMoney(order.amountCents, order.currency)}</Descriptions.Item>
            <Descriptions.Item label="Credits">{order.credits}</Descriptions.Item>
            <Descriptions.Item label="状态"><StatusBadge status={order.status} /></Descriptions.Item>
            <Descriptions.Item label="履约"><StatusBadge status={order.fulfillmentStatus} /></Descriptions.Item>
            <Descriptions.Item label="用户">{order.userId.slice(0, 8)}</Descriptions.Item>
            <Descriptions.Item label="Workspace">{order.workspaceId.slice(0, 8)}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{fmtDate(order.createdAt)}</Descriptions.Item>
          </Descriptions>
          {order.snapshotJson && (
            <pre className="mt-3 bg-gray-100 rounded-xl p-3 text-xs text-gray-800 overflow-x-auto">
              {JSON.stringify(order.snapshotJson, null, 2)}
            </pre>
          )}
        </Card>

        <Card
          title="支付交易"
          extra={
            <div className="flex gap-2">
              {order.status === 'SUCCEEDED' && order.fulfillmentStatus !== 'SUCCEEDED' && (
                <Button size="small" disabled={busy} onClick={() => void retryFulfillment()}>
                  重试履约
                </Button>
              )}
              {order.status === 'PENDING' && (
                <Button size="small" danger disabled={busy} onClick={() => void closeOrder()}>
                  关闭订单
                </Button>
              )}
            </div>
          }
        >
          {order.paymentTransactions.length === 0 ? (
            <div className="text-gray-400 text-sm">无支付记录</div>
          ) : (
            <Table<TxnItem>
              rowKey="id"
              columns={txnColumns}
              dataSource={order.paymentTransactions}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </Card>

        <Card title="履约信息">
          {order.fulfillment ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="状态"><StatusBadge status={order.fulfillment.status} /></Descriptions.Item>
              <Descriptions.Item label="订阅">{order.fulfillment.subscriptionId ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="发放 Credits">{order.fulfillment.creditsGranted}</Descriptions.Item>
              <Descriptions.Item label="错误">{order.fulfillment.errorMessage ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="完成时间">{fmtDate(order.fulfillment.completedAt)}</Descriptions.Item>
            </Descriptions>
          ) : (
            <p className="text-gray-400 text-sm">无履约记录</p>
          )}
        </Card>

        <Card title="钱包账本">
          {order.ledger.length === 0 ? (
            <div className="text-gray-400 text-sm">无账本记录</div>
          ) : (
            <Table
              rowKey="id"
              columns={[
                { title: '类型', dataIndex: 'type', key: 'type', render: (v: string) => <StatusBadge status={v} /> },
                { title: '金额', dataIndex: 'amount', key: 'amount' },
                { title: '余额', dataIndex: 'balanceAfter', key: 'balanceAfter', render: (v: number) => <span className="text-gray-600">{v}</span> },
                { title: '描述', dataIndex: 'description', key: 'description', render: (v?: string) => <span className="text-gray-500">{v ?? '—'}</span> },
                { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
              ]}
              dataSource={order.ledger}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </Card>
      </div>
    </div>
  )
}
