'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminGenerationsApi, type AdminGenerationDetailView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { BackLink, Card, DataTable, EmptyState, Loading, StatusBadge, fmtDate, fmtMicrousd } from './AdminUi'

export default function AdminGenerationDetailView({ jobId }: { jobId: string }) {
  const { alert, confirm } = useDialog()
  const [job, setJob] = useState<AdminGenerationDetailView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setJob(await adminGenerationsApi.detail(jobId))
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [jobId, alert])

  useEffect(() => {
    void load()
  }, [load])

  const forceFail = async () => {
    const reason = window.prompt('请输入失败原因（将写入审计日志）：', 'Worker 挂死，人工救援')
    if (!reason) return
    const ok = await confirm({
      title: '强制失败',
      message: `确定要将该任务标记为失败并释放预留 Credits 吗？\n原因：${reason}`,
      confirmVariant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      await adminGenerationsApi.forceFail(jobId, reason)
      await load()
      await alert({ title: '已处理', message: '任务已标记失败并释放预留' })
    } catch (e) {
      await alert({ title: '操作失败', message: formatErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const replay = async () => {
    const ok = await confirm({
      title: '重新投递',
      message: '确定要重置 outbox 并重新投递该任务吗？幂等操作。',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await adminGenerationsApi.replay(jobId)
      await load()
      await alert({ title: '已投递', message: `已重置 ${r.reset} 条投递记录` })
    } catch (e) {
      await alert({ title: '操作失败', message: formatErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (!job) return <EmptyState text="任务不存在" />

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 pb-2">
        <BackLink href="/app/admin/generations" label="返回任务列表" />
        <h2 className="text-xl font-extrabold text-white mt-2">生成任务详情</h2>
        <p className="text-sm text-white/50">{job.id}</p>
      </div>

      <div className="p-5 space-y-5">
        <Card
          title="基本信息"
          action={
            <div className="flex gap-2">
              {(job.status === 'QUEUED' || job.status === 'RUNNING') && (
                <>
                  <button className="btn-ghost text-xs" disabled={busy} onClick={() => void replay()}>重投</button>
                  <button className="btn-danger text-xs" disabled={busy} onClick={() => void forceFail()}>强制失败</button>
                </>
              )}
            </div>
          }
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div><p className="text-white/50">类型</p><p className="font-bold text-white">{job.type}</p></div>
            <div><p className="text-white/50">Provider</p><p className="font-bold text-white">{job.provider ?? '—'}</p></div>
            <div><p className="text-white/50">模型</p><p className="font-bold text-white">{job.model ?? '—'}</p></div>
            <div><p className="text-white/50">状态</p><p className="font-bold text-white"><StatusBadge status={job.status} /></p></div>
            <div><p className="text-white/50">尝试次数</p><p className="font-bold text-white">{job.attemptCount}</p></div>
            <div><p className="text-white/50">Provider Job</p><p className="font-bold text-white">{job.providerJobId ?? '—'}</p></div>
            <div><p className="text-white/50">成本状态</p><p className="font-bold text-white">{job.costStatus}</p></div>
            <div><p className="text-white/50">错误</p><p className="font-bold text-rose-300">{job.errorCode ?? '—'}</p></div>
          </div>
          {job.errorMessage && (
            <p className="mt-3 text-sm text-rose-300">{job.errorMessage}</p>
          )}
        </Card>

        <Card title="报价（冻结）">
          {job.quote ? (
            <div className="text-sm text-white/70 space-y-1">
              <p>Pricing Version：{job.quote.pricingVersionId.slice(0, 8)}</p>
              <p>估算 Credits：{job.quote.estimatedCredits}</p>
              <p>估算成本：{fmtMicrousd(job.quote.estimatedCostMicrousd)}</p>
              <p>过期时间：{fmtDate(job.quote.expiresAt)}</p>
            </div>
          ) : (
            <p className="text-white/40 text-sm">无冻结报价</p>
          )}
        </Card>

        <Card title="Credit 预留 / 结算">
          {job.reservation ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div><p className="text-white/50">预留</p><p className="font-bold text-white">{job.reservation.reservedCredits}</p></div>
              <div><p className="text-white/50">已结算</p><p className="font-bold text-cyan-300">{job.reservation.capturedCredits}</p></div>
              <div><p className="text-white/50">已释放</p><p className="font-bold text-white">{job.reservation.releasedCredits}</p></div>
              <div><p className="text-white/50">状态</p><p className="font-bold text-white"><StatusBadge status={job.reservation.status} /></p></div>
            </div>
          ) : (
            <p className="text-white/40 text-sm">无预留记录</p>
          )}
        </Card>

        <Card title="Attempts">
          {job.attempts.length === 0 ? (
            <EmptyState text="无尝试记录" />
          ) : (
            <DataTable headers={['#', 'Provider', '模型', '状态', 'Provider Job', '估算', '上报', '开始', '结束']}>
              {job.attempts.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2">{a.attemptNo}</td>
                  <td className="px-3 py-2 text-white/60">{a.provider}</td>
                  <td className="px-3 py-2 text-white/60">{a.model}</td>
                  <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                  <td className="px-3 py-2 text-white/60">{a.providerJobId ?? '—'}</td>
                  <td className="px-3 py-2">{fmtMicrousd(a.estimatedCostMicrousd)}</td>
                  <td className="px-3 py-2">{fmtMicrousd(a.reportedCostMicrousd)}</td>
                  <td className="px-3 py-2 text-white/50">{fmtDate(a.startedAt)}</td>
                  <td className="px-3 py-2 text-white/50">{fmtDate(a.endedAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        <Card title="Outbox 投递记录">
          {job.outbox.length === 0 ? (
            <EmptyState text="无投递记录" />
          ) : (
            <DataTable headers={['事件', '状态', '尝试', '错误', '投递时间', '创建时间']}>
              {job.outbox.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2">{o.eventType}</td>
                  <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-3 py-2">{o.attempts}</td>
                  <td className="px-3 py-2 text-rose-300">{o.lastError ?? '—'}</td>
                  <td className="px-3 py-2 text-white/50">{fmtDate(o.dispatchedAt)}</td>
                  <td className="px-3 py-2 text-white/50">{fmtDate(o.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        <Card title="Usage Event">
          {job.usageEvent ? (
            <div className="text-sm text-white/70 space-y-1">
              <p>估算：{fmtMicrousd(job.usageEvent.estimatedCostMicrousd)} · 上报：{fmtMicrousd(job.usageEvent.reportedCostMicrousd)} · 最终：{fmtMicrousd(job.usageEvent.finalCostMicrousd)}</p>
              <p>成本状态：{job.usageEvent.costStatus} · 扣费 Credits：{job.usageEvent.creditsCharged}</p>
            </div>
          ) : (
            <p className="text-white/40 text-sm">无用量事件</p>
          )}
        </Card>
      </div>
    </div>
  )
}