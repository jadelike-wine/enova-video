'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminAuditApi, type AdminAuditView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { Card, DataTable, EmptyState, Loading, PageHeader, fmtDate } from './AdminUi'

const PAGE_SIZE = 50

export default function AdminAuditView() {
  const { alert } = useDialog()
  const [logs, setLogs] = useState<AdminAuditView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setLogs(await adminAuditApi.list({ limit: PAGE_SIZE, offset }))
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [offset, alert])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="审计日志" />
      <div className="p-5">
        <Card>
          {loading ? (
            <Loading />
          ) : logs.length === 0 ? (
            <EmptyState text="暂无审计记录" />
          ) : (
            <DataTable headers={['时间', '操作', '资源类型', '资源', '操作者', 'Before', 'After', 'IP']}>
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-100">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                  <td className="px-3 py-2 text-gray-800">{l.action}</td>
                  <td className="px-3 py-2 text-gray-600">{l.resourceType}</td>
                  <td className="px-3 py-2 text-gray-500">{l.resourceId?.slice(0, 8) ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{l.actorUserId?.slice(0, 8) ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{l.before ? JSON.stringify(l.before) : '—'}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{l.after ? JSON.stringify(l.after) : '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{l.ip ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          )}
          <div className="flex items-center justify-between pt-3">
            <button className="btn-ghost text-xs" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              上一页
            </button>
            <span className="text-xs text-gray-400">offset {offset}</span>
            <button className="btn-ghost text-xs" disabled={logs.length < PAGE_SIZE || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
              下一页
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}