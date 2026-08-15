'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Select, Skeleton, Table } from 'antd'
import type { TableProps } from 'antd'
import { adminOrdersApi, type AdminOrderView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { useTablePagination } from '../../../lib/useTablePagination'
import { AdminLink, ContentLoading, PageHeader, StatusBadge, fmtDate, fmtMoney } from './AdminUi'

const STATUS_OPTIONS = ['', 'PENDING', 'SUCCEEDED', 'FAILED']
const TYPE_OPTIONS = ['', 'RECHARGE', 'PLAN', 'CREDIT_PACK']

export default function AdminOrdersView() {
  const { alert } = useDialog()
  const [orders, setOrders] = useState<AdminOrderView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState('')
  const [orderType, setOrderType] = useState('')

  const { defaultPageSize } = useTablePagination()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await adminOrdersApi.list({
        limit: defaultPageSize,
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
  }, [offset, status, orderType, defaultPageSize, alert])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && orders.length === 0) return <ContentLoading />

  const columns: TableProps<AdminOrderView>['columns'] = [
    { title: '订单', dataIndex: 'id', key: 'id', render: (v: string) => <span className="text-gray-600">{v.slice(0, 8)}</span> },
    { title: '用户', dataIndex: 'userId', key: 'userId', render: (v: string) => <span className="text-gray-600">{v.slice(0, 8)}</span> },
    { title: '类型', dataIndex: 'orderType', key: 'orderType' },
    { title: '金额', dataIndex: 'amountCents', key: 'amount', render: (_, r) => fmtMoney(r.amountCents, r.currency) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: '履约', dataIndex: 'fulfillmentStatus', key: 'fulfillment', render: (v: string) => <StatusBadge status={v} /> },
    { title: 'Credits', dataIndex: 'credits', key: 'credits' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
    {
      title: '操作',
      key: 'action',
      render: (_, r) => <AdminLink href={`/app/admin/orders/${r.id}`}>详情</AdminLink>,
    },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="订单管理" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Select
            className="w-40"
            value={status}
            onChange={(v) => { setStatus(v); setOffset(0) }}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s ? `状态：${s}` : '全部状态' }))}
          />
          <Select
            className="w-40"
            value={orderType}
            onChange={(v) => { setOrderType(v); setOffset(0) }}
            options={TYPE_OPTIONS.map((t) => ({ value: t, label: t ? `类型：${t}` : '全部类型' }))}
          />
        </div>

        <Card>
          <Skeleton loading={loading && orders.length === 0} active>
            <Table<AdminOrderView>
              rowKey="id"
              columns={columns}
              dataSource={orders}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '没有订单' }}
            />
          </Skeleton>
          <div className="flex items-center justify-between pt-3">
            <Button size="small" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - defaultPageSize))}>
              上一页
            </Button>
            <span className="text-xs text-gray-400">offset {offset}</span>
            <Button size="small" disabled={orders.length < defaultPageSize || loading} onClick={() => setOffset(offset + defaultPageSize)}>
              下一页
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
