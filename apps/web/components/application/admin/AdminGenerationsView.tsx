'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Select, Skeleton, Table } from 'antd'
import type { TableProps } from 'antd'
import { adminGenerationsApi, type AdminGenerationView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { AdminLink, PageHeader, StatusBadge, fmtDate } from './AdminUi'

const PAGE_SIZE = 50
const STATUS_OPTIONS = ['', 'PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED']

export default function AdminGenerationsView() {
  const { alert } = useDialog()
  const [jobs, setJobs] = useState<AdminGenerationView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await adminGenerationsApi.list({ limit: PAGE_SIZE, offset, status: status || undefined })
      setJobs(rows)
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [offset, status, alert])

  useEffect(() => {
    void load()
  }, [load])

  const columns: TableProps<AdminGenerationView>['columns'] = [
    { title: 'Job', dataIndex: 'id', key: 'id', render: (v: string) => <span className="text-gray-600">{v.slice(0, 8)}</span> },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider', render: (v?: string) => <span className="text-gray-600">{v ?? '—'}</span> },
    { title: '模型', dataIndex: 'model', key: 'model', render: (v?: string) => <span className="text-gray-600">{v ?? '—'}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: '尝试', dataIndex: 'attemptCount', key: 'attemptCount' },
    { title: '最终成本', dataIndex: 'finalCostMicrousd', key: 'finalCost', render: (v?: number) => v ? `$${(v / 1_000_000).toFixed(4)}` : '—' },
    { title: '错误', dataIndex: 'errorCode', key: 'errorCode', render: (v?: string) => <span className="text-rose-600">{v ?? '—'}</span> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
    {
      title: '操作',
      key: 'action',
      render: (_, r) => <AdminLink href={`/app/admin/generations/${r.id}`}>详情</AdminLink>,
    },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="生成任务" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Select
            className="w-48"
            value={status}
            onChange={(v) => { setStatus(v); setOffset(0) }}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s ? `状态：${s}` : '全部状态' }))}
          />
        </div>

        <Card>
          <Skeleton loading={loading && jobs.length === 0} active>
            <Table<AdminGenerationView>
              rowKey="id"
              columns={columns}
              dataSource={jobs}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '没有生成任务' }}
            />
          </Skeleton>
          <div className="flex items-center justify-between pt-3">
            <Button size="small" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              上一页
            </Button>
            <span className="text-xs text-gray-400">offset {offset}</span>
            <Button size="small" disabled={jobs.length < PAGE_SIZE || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
              下一页
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
