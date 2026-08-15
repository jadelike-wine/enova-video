'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Skeleton, Table } from 'antd'
import type { TableProps } from 'antd'
import { adminAuditApi, type AdminAuditView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { useTablePagination } from '../../../lib/useTablePagination'
import { ContentLoading, PageHeader, fmtDate } from './AdminUi'

export default function AdminAuditView() {
  const { alert } = useDialog()
  const [logs, setLogs] = useState<AdminAuditView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  const { defaultPageSize } = useTablePagination()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setLogs(await adminAuditApi.list({ limit: defaultPageSize, offset }))
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [offset, defaultPageSize, alert])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && logs.length === 0) return <ContentLoading />

  const columns: TableProps<AdminAuditView>['columns'] = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500 whitespace-nowrap">{fmtDate(v)}</span> },
    { title: '操作', dataIndex: 'action', key: 'action', render: (v: string) => <span className="text-gray-800">{v}</span> },
    { title: '资源类型', dataIndex: 'resourceType', key: 'resourceType', render: (v: string) => <span className="text-gray-600">{v}</span> },
    { title: '资源', dataIndex: 'resourceId', key: 'resourceId', render: (v?: string) => <span className="text-gray-500">{v?.slice(0, 8) ?? '—'}</span> },
    { title: '操作者', dataIndex: 'actorUserId', key: 'actorUserId', render: (v?: string) => <span className="text-gray-600">{v?.slice(0, 8) ?? '—'}</span> },
    { title: 'Before', dataIndex: 'before', key: 'before', ellipsis: true, render: (v: unknown) => <span className="text-gray-500">{v ? JSON.stringify(v) : '—'}</span> },
    { title: 'After', dataIndex: 'after', key: 'after', ellipsis: true, render: (v: unknown) => <span className="text-gray-500">{v ? JSON.stringify(v) : '—'}</span> },
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (v?: string) => <span className="text-gray-500">{v ?? '—'}</span> },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="审计日志" />
      <div className="p-5">
        <Card>
          <Skeleton loading={loading && logs.length === 0} active>
            <Table<AdminAuditView>
              rowKey="id"
              columns={columns}
              dataSource={logs}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '暂无审计记录' }}
            />
          </Skeleton>
          <div className="flex items-center justify-between pt-3">
            <Button size="small" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - defaultPageSize))}>
              上一页
            </Button>
            <span className="text-xs text-gray-400">offset {offset}</span>
            <Button size="small" disabled={logs.length < defaultPageSize || loading} onClick={() => setOffset(offset + defaultPageSize)}>
              下一页
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
