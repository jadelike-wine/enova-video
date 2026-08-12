'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminGenerationsApi, type AdminGenerationView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { AdminLink, Card, DataTable, EmptyState, Loading, PageHeader, StatusBadge, fmtDate } from './AdminUi'

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

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="生成任务" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <select className="input-field" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0) }}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s ? `状态：${s}` : '全部状态'}</option>
            ))}
          </select>
        </div>

        <Card>
          {loading ? (
            <Loading />
          ) : jobs.length === 0 ? (
            <EmptyState text="没有生成任务" />
          ) : (
            <DataTable
              headers={['Job', '类型', 'Provider', '模型', '状态', '尝试', '最终成本', '错误', '创建时间', '操作']}
            >
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-white/5">
                  <td className="px-3 py-2 text-white/60">{j.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{j.type}</td>
                  <td className="px-3 py-2 text-white/60">{j.provider ?? '—'}</td>
                  <td className="px-3 py-2 text-white/60">{j.model ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={j.status} /></td>
                  <td className="px-3 py-2">{j.attemptCount}</td>
                  <td className="px-3 py-2 text-white/60">{j.finalCostMicrousd ? `$${(j.finalCostMicrousd / 1_000_000).toFixed(4)}` : '—'}</td>
                  <td className="px-3 py-2 text-rose-300">{j.errorCode ?? '—'}</td>
                  <td className="px-3 py-2 text-white/50">{fmtDate(j.createdAt)}</td>
                  <td className="px-3 py-2">
                    <AdminLink href={`/app/admin/generations/${j.id}`}>详情</AdminLink>
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
            <button className="btn-ghost text-xs" disabled={jobs.length < PAGE_SIZE || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
              下一页
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}