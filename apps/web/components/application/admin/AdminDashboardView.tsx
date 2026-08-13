'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminStatsApi, type AdminStatsView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { Card, Loading, PageHeader } from './AdminUi'

export default function AdminDashboardView() {
  const { alert } = useDialog()
  const [stats, setStats] = useState<AdminStatsView | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStats(await adminStatsApi.summary())
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Loading />

  const statCards: Array<{ label: string; value: number; unit?: string }> = [
    { label: '用户', value: stats?.users ?? 0 },
    { label: '工作区', value: stats?.workspaces ?? 0 },
    { label: '生成任务', value: stats?.generations ?? 0 },
    { label: '可用余额', value: stats?.totalBalance ?? 0, unit: 'Credits' },
    { label: '预留余额', value: stats?.totalReservedBalance ?? 0, unit: 'Credits' },
    { label: '累计消耗', value: stats?.totalCreditsSpent ?? 0, unit: 'Credits' },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="运营概览" />

      <div className="p-5 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {statCards.map((c) => (
            <Card key={c.label}>
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-2xl font-extrabold mt-1 text-gray-900">
                {c.value.toLocaleString()}
                {c.unit && <span className="text-xs font-normal text-gray-500 ml-1">{c.unit}</span>}
              </p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="任务状态分布">
            {stats && Object.keys(stats.generationsByStatus).length > 0 ? (
              <ul className="space-y-2">
                {Object.entries(stats.generationsByStatus).map(([k, v]) => (
                  <li key={k} className="flex justify-between text-sm">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-semibold text-gray-900">{v}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-400 text-sm">暂无数据</p>
            )}
          </Card>
          <Card title="任务类型分布">
            {stats && Object.keys(stats.generationsByType).length > 0 ? (
              <ul className="space-y-2">
                {Object.entries(stats.generationsByType).map(([k, v]) => (
                  <li key={k} className="flex justify-between text-sm">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-semibold text-gray-900">{v}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-400 text-sm">暂无数据</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}