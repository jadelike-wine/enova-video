'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, Descriptions, Table } from 'antd'
import type { TableProps } from 'antd'
import { adminCustomersApi, type Customer360View } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { BackLink, ContentLoading, PageHeader, StatusBadge, fmtDate, fmtMicrousd, fmtMoney } from './AdminUi'

export default function AdminCustomer360View({ userId }: { userId: string }) {
  const { alert } = useDialog()
  const [data, setData] = useState<Customer360View | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await adminCustomersApi.get360(userId))
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [userId, alert])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <ContentLoading />
  if (!data) return <div className="p-10 text-center text-gray-400">无法加载用户数据</div>

  type ReservationItem = Customer360View['reservations'][number]
  type LedgerItem = Customer360View['ledger'][number]
  type PaymentItem = Customer360View['payments'][number]
  type GenerationItem = Customer360View['recentGenerations'][number]
  type UsageItem = Customer360View['recentUsage'][number]
  type AuditItem = Customer360View['audit'][number]

  const reservationColumns: TableProps<ReservationItem>['columns'] = [
    { title: 'Job', dataIndex: 'generationJobId', key: 'job', render: (v: string) => <span className="text-gray-600">{v.slice(0, 8)}</span> },
    { title: '预留', dataIndex: 'reservedCredits', key: 'reserved' },
    { title: '已结算', dataIndex: 'capturedCredits', key: 'captured', render: (v: number) => <span className="text-cyan-600">{v}</span> },
    { title: '已释放', dataIndex: 'releasedCredits', key: 'released', render: (v: number) => <span className="text-gray-600">{v}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  const ledgerColumns: TableProps<LedgerItem>['columns'] = [
    { title: '类型', dataIndex: 'type', key: 'type', render: (v: string) => <StatusBadge status={v} /> },
    { title: '金额', dataIndex: 'amount', key: 'amount' },
    { title: '余额', dataIndex: 'balanceAfter', key: 'balanceAfter', render: (v: number) => <span className="text-gray-600">{v}</span> },
    { title: '描述', dataIndex: 'description', key: 'description', render: (v?: string) => <span className="text-gray-500">{v ?? '—'}</span> },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  const paymentColumns: TableProps<PaymentItem>['columns'] = [
    { title: '订单', dataIndex: 'orderId', key: 'orderId', render: (v: string) => <span className="text-gray-600">{v.slice(0, 8)}</span> },
    { title: '类型', dataIndex: 'orderType', key: 'orderType' },
    { title: '金额', key: 'amount', render: (_, r) => fmtMoney(r.amountCents, r.currency) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: '履约', dataIndex: 'fulfillmentStatus', key: 'fulfillment', render: (v: string) => <StatusBadge status={v} /> },
    { title: 'Provider', dataIndex: 'provider', key: 'provider', render: (v?: string) => <span className="text-gray-600">{v ?? '—'}</span> },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  const generationColumns: TableProps<GenerationItem>['columns'] = [
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider', render: (v?: string) => <span className="text-gray-600">{v ?? '—'}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: '估算', dataIndex: 'estimatedCredits', key: 'estimated' },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  const usageColumns: TableProps<UsageItem>['columns'] = [
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider', render: (v: string) => <span className="text-gray-600">{v}</span> },
    { title: '最终成本', dataIndex: 'finalCostMicrousd', key: 'finalCost', render: (v?: number) => fmtMicrousd(v) },
    { title: '扣费', dataIndex: 'creditsCharged', key: 'credits', render: (v: number) => <span className="text-cyan-600">{v}</span> },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  const auditColumns: TableProps<AuditItem>['columns'] = [
    { title: 'Action', dataIndex: 'action', key: 'action', render: (v: string) => <span className="text-gray-800">{v}</span> },
    { title: '资源类型', dataIndex: 'resourceType', key: 'resourceType', render: (v: string) => <span className="text-gray-600">{v}</span> },
    { title: '资源', dataIndex: 'resourceId', key: 'resourceId', render: (v?: string) => <span className="text-gray-500">{v?.slice(0, 8) ?? '—'}</span> },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 pb-2">
        <BackLink href="/app/admin/users" label="返回用户列表" />
        <PageHeader title={data.user.email} />
        <p className="text-sm text-gray-500">
          {data.user.id} · {data.user.role} · <StatusBadge status={data.user.status} /> · 注册于 {fmtDate(data.user.createdAt)}
        </p>
      </div>

      <div className="p-5 space-y-5">
        {/* 概览卡片 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card title="可用余额">
            <p className="text-2xl font-extrabold text-cyan-600">{data.wallet?.balance ?? 0}</p>
          </Card>
          <Card title="预留余额">
            <p className="text-2xl font-extrabold text-gray-800">{data.wallet?.reservedBalance ?? 0}</p>
          </Card>
          <Card title="当前订阅">
            <p className="text-lg font-bold text-gray-900">{data.subscription?.planName ?? '无'}</p>
            <p className="text-xs text-gray-500">
              {data.subscription?.status ?? '—'} · {fmtDate(data.subscription?.currentPeriodEnd)}
            </p>
          </Card>
          <Card title="累计消耗">
            <p className="text-2xl font-extrabold text-gray-800">{data.generationsSummary.totalCreditsCharged}</p>
            <p className="text-xs text-gray-500">Credits</p>
          </Card>
        </div>

        {/* Workspace */}
        <Card title="Workspace">
          {data.workspace ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="名称">{data.workspace.name}</Descriptions.Item>
              <Descriptions.Item label="ID">{data.workspace.id}</Descriptions.Item>
              <Descriptions.Item label="详情">
                类型：{data.workspace.type} · 角色：{data.workspace.role} · 创建于 {fmtDate(data.workspace.createdAt)}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <p className="text-gray-400 text-sm">无 Workspace</p>
          )}
        </Card>

        {/* 生成任务统计 */}
        <Card title="生成任务统计">
          <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
            <Descriptions.Item label="总数">{data.generationsSummary.total}</Descriptions.Item>
            <Descriptions.Item label="估算成本">{fmtMicrousd(data.generationsSummary.totalEstimatedCostMicrousd)}</Descriptions.Item>
            <Descriptions.Item label="最终成本">{fmtMicrousd(data.generationsSummary.totalFinalCostMicrousd)}</Descriptions.Item>
            <Descriptions.Item label="状态分布">
              {Object.entries(data.generationsSummary.byStatus).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Reservations */}
        <Card title="Credit Reservations">
          {data.reservations.length === 0 ? (
            <div className="text-gray-400 text-sm">暂无预留</div>
          ) : (
            <Table<ReservationItem>
              rowKey="id"
              columns={reservationColumns}
              dataSource={data.reservations}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </Card>

        {/* Ledger */}
        <Card title="钱包账本">
          {data.ledger.length === 0 ? (
            <div className="text-gray-400 text-sm">暂无账本记录</div>
          ) : (
            <Table<LedgerItem>
              rowKey="id"
              columns={ledgerColumns}
              dataSource={data.ledger}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </Card>

        {/* Payments */}
        <Card title="订单 / 支付">
          {data.payments.length === 0 ? (
            <div className="text-gray-400 text-sm">暂无订单</div>
          ) : (
            <Table<PaymentItem>
              rowKey="orderId"
              columns={paymentColumns}
              dataSource={data.payments}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </Card>

        {/* Generations / Usage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card title="最近生成任务">
            {data.recentGenerations.length === 0 ? (
              <div className="text-gray-400 text-sm">暂无</div>
            ) : (
              <Table<GenerationItem>
                rowKey="id"
                columns={generationColumns}
                dataSource={data.recentGenerations}
                pagination={false}
                size="small"
                scroll={{ x: 'max-content' }}
              />
            )}
          </Card>
          <Card title="最近用量">
            {data.recentUsage.length === 0 ? (
              <div className="text-gray-400 text-sm">暂无</div>
            ) : (
              <Table<UsageItem>
                rowKey="id"
                columns={usageColumns}
                dataSource={data.recentUsage}
                pagination={false}
                size="small"
                scroll={{ x: 'max-content' }}
              />
            )}
          </Card>
        </div>

        {/* Audit */}
        <Card title="审计日志">
          {data.audit.length === 0 ? (
            <div className="text-gray-400 text-sm">暂无审计记录</div>
          ) : (
            <Table<AuditItem>
              rowKey="id"
              columns={auditColumns}
              dataSource={data.audit}
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
