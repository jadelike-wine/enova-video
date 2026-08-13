'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminCustomersApi, type Customer360View } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { BackLink, Card, DataTable, EmptyState, Loading, StatusBadge, fmtDate, fmtMicrousd, fmtMoney } from './AdminUi'

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

  if (loading) return <Loading />
  if (!data) return <EmptyState text="无法加载用户数据" />

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 pb-2">
        <BackLink href="/app/admin/users" label="返回用户列表" />
        <h2 className="text-xl font-extrabold text-gray-900 mt-2">{data.user.email}</h2>
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
            <div className="text-sm text-gray-700 space-y-1">
              <p>名称：{data.workspace.name}</p>
              <p>ID：{data.workspace.id}</p>
              <p>类型：{data.workspace.type} · 角色：{data.workspace.role} · 创建于 {fmtDate(data.workspace.createdAt)}</p>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">无 Workspace</p>
          )}
        </Card>

        {/* 生成任务统计 */}
        <Card title="生成任务统计">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div><p className="text-gray-500">总数</p><p className="font-bold text-gray-900">{data.generationsSummary.total}</p></div>
            <div><p className="text-gray-500">估算成本</p><p className="font-bold text-gray-900">{fmtMicrousd(data.generationsSummary.totalEstimatedCostMicrousd)}</p></div>
            <div><p className="text-gray-500">最终成本</p><p className="font-bold text-gray-900">{fmtMicrousd(data.generationsSummary.totalFinalCostMicrousd)}</p></div>
            <div><p className="text-gray-500">状态分布</p><p className="font-bold text-gray-900">{Object.entries(data.generationsSummary.byStatus).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}</p></div>
          </div>
        </Card>

        {/* Reservations */}
        <Card title="Credit Reservations">
          {data.reservations.length === 0 ? (
            <EmptyState text="暂无预留" />
          ) : (
            <DataTable headers={['Job', '预留', '已结算', '已释放', '状态', '创建时间']}>
              {data.reservations.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-gray-600">{r.generationJobId.slice(0, 8)}</td>
                  <td className="px-3 py-2">{r.reservedCredits}</td>
                  <td className="px-3 py-2 text-cyan-600">{r.capturedCredits}</td>
                  <td className="px-3 py-2 text-gray-600">{r.releasedCredits}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-gray-500">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        {/* Ledger */}
        <Card title="钱包账本">
          {data.ledger.length === 0 ? (
            <EmptyState text="暂无账本记录" />
          ) : (
            <DataTable headers={['类型', '金额', '余额', '描述', '时间']}>
              {data.ledger.map((l) => (
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

        {/* Payments */}
        <Card title="订单 / 支付">
          {data.payments.length === 0 ? (
            <EmptyState text="暂无订单" />
          ) : (
            <DataTable headers={['订单', '类型', '金额', '状态', '履约', 'Provider', '时间']}>
              {data.payments.map((p) => (
                <tr key={p.orderId}>
                  <td className="px-3 py-2 text-gray-600">{p.orderId.slice(0, 8)}</td>
                  <td className="px-3 py-2">{p.orderType}</td>
                  <td className="px-3 py-2">{fmtMoney(p.amountCents, p.currency)}</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                  <td className="px-3 py-2"><StatusBadge status={p.fulfillmentStatus} /></td>
                  <td className="px-3 py-2 text-gray-600">{p.provider ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        {/* Generations / Usage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card title="最近生成任务">
            {data.recentGenerations.length === 0 ? (
              <EmptyState text="暂无" />
            ) : (
              <DataTable headers={['类型', 'Provider', '状态', '估算', '时间']}>
                {data.recentGenerations.map((g) => (
                  <tr key={g.id}>
                    <td className="px-3 py-2">{g.type}</td>
                    <td className="px-3 py-2 text-gray-600">{g.provider ?? '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={g.status} /></td>
                    <td className="px-3 py-2">{g.estimatedCredits}</td>
                    <td className="px-3 py-2 text-gray-500">{fmtDate(g.createdAt)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
          <Card title="最近用量">
            {data.recentUsage.length === 0 ? (
              <EmptyState text="暂无" />
            ) : (
              <DataTable headers={['类型', 'Provider', '最终成本', '扣费', '时间']}>
                {data.recentUsage.map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-2">{u.type}</td>
                    <td className="px-3 py-2 text-gray-600">{u.provider}</td>
                    <td className="px-3 py-2">{fmtMicrousd(u.finalCostMicrousd)}</td>
                    <td className="px-3 py-2 text-cyan-600">{u.creditsCharged}</td>
                    <td className="px-3 py-2 text-gray-500">{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
        </div>

        {/* Audit */}
        <Card title="审计日志">
          {data.audit.length === 0 ? (
            <EmptyState text="暂无审计记录" />
          ) : (
            <DataTable headers={['Action', '资源类型', '资源', '时间']}>
              {data.audit.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 text-gray-800">{a.action}</td>
                  <td className="px-3 py-2 text-gray-600">{a.resourceType}</td>
                  <td className="px-3 py-2 text-gray-500">{a.resourceId?.slice(0, 8) ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </div>
  )
}