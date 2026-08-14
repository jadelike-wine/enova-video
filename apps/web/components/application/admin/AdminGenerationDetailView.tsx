'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Descriptions, Skeleton, Table } from 'antd'
import type { TableProps } from 'antd'
import { adminGenerationsApi, type AdminGenerationDetailView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { BackLink, PageHeader, StatusBadge, fmtDate, fmtMicrousd } from './AdminUi'

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

  if (loading) return (
    <div className="p-5">
      <Skeleton active paragraph={{ rows: 10 }} />
    </div>
  )
  if (!job) return <div className="p-10 text-center text-gray-400">任务不存在</div>

  type AttemptItem = AdminGenerationDetailView['attempts'][number]
  type OutboxItem = AdminGenerationDetailView['outbox'][number]

  const attemptColumns: TableProps<AttemptItem>['columns'] = [
    { title: '#', dataIndex: 'attemptNo', key: 'attemptNo' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider', render: (v: string) => <span className="text-gray-600">{v}</span> },
    { title: '模型', dataIndex: 'model', key: 'model', render: (v: string) => <span className="text-gray-600">{v}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: 'Provider Job', dataIndex: 'providerJobId', key: 'providerJobId', render: (v?: string) => <span className="text-gray-600">{v ?? '—'}</span> },
    { title: '估算', dataIndex: 'estimatedCostMicrousd', key: 'estimated', render: (v?: number) => fmtMicrousd(v) },
    { title: '上报', dataIndex: 'reportedCostMicrousd', key: 'reported', render: (v?: number) => fmtMicrousd(v) },
    { title: '开始', dataIndex: 'startedAt', key: 'startedAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
    { title: '结束', dataIndex: 'endedAt', key: 'endedAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  const outboxColumns: TableProps<OutboxItem>['columns'] = [
    { title: '事件', dataIndex: 'eventType', key: 'eventType' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusBadge status={v} /> },
    { title: '尝试', dataIndex: 'attempts', key: 'attempts' },
    { title: '错误', dataIndex: 'lastError', key: 'lastError', render: (v?: string) => <span className="text-rose-600">{v ?? '—'}</span> },
    { title: '投递时间', dataIndex: 'dispatchedAt', key: 'dispatchedAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 pb-2">
        <BackLink href="/app/admin/generations" label="返回任务列表" />
        <PageHeader title="生成任务详情" />
        <p className="text-sm text-gray-500">{job.id}</p>
      </div>

      <div className="p-5 space-y-5">
        <Card
          title="基本信息"
          extra={
            <div className="flex gap-2">
              {(job.status === 'QUEUED' || job.status === 'RUNNING') && (
                <>
                  <Button size="small" disabled={busy} onClick={() => void replay()}>重投</Button>
                  <Button size="small" danger disabled={busy} onClick={() => void forceFail()}>强制失败</Button>
                </>
              )}
            </div>
          }
        >
          <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
            <Descriptions.Item label="类型">{job.type}</Descriptions.Item>
            <Descriptions.Item label="Provider">{job.provider ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="模型">{job.model ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="状态"><StatusBadge status={job.status} /></Descriptions.Item>
            <Descriptions.Item label="尝试次数">{job.attemptCount}</Descriptions.Item>
            <Descriptions.Item label="Provider Job">{job.providerJobId ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="成本状态">{job.costStatus}</Descriptions.Item>
            <Descriptions.Item label="错误"><span className="text-rose-600">{job.errorCode ?? '—'}</span></Descriptions.Item>
          </Descriptions>
          {job.errorMessage && (
            <p className="mt-3 text-sm text-rose-600">{job.errorMessage}</p>
          )}
        </Card>

        <Card title="报价（冻结）">
          {job.quote ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Pricing Version">{job.quote.pricingVersionId.slice(0, 8)}</Descriptions.Item>
              <Descriptions.Item label="估算 Credits">{job.quote.estimatedCredits}</Descriptions.Item>
              <Descriptions.Item label="估算成本">{fmtMicrousd(job.quote.estimatedCostMicrousd)}</Descriptions.Item>
              <Descriptions.Item label="过期时间">{fmtDate(job.quote.expiresAt)}</Descriptions.Item>
            </Descriptions>
          ) : (
            <p className="text-gray-400 text-sm">无冻结报价</p>
          )}
        </Card>

        <Card title="Credit 预留 / 结算">
          {job.reservation ? (
            <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
              <Descriptions.Item label="预留">{job.reservation.reservedCredits}</Descriptions.Item>
              <Descriptions.Item label="已结算"><span className="text-cyan-600">{job.reservation.capturedCredits}</span></Descriptions.Item>
              <Descriptions.Item label="已释放">{job.reservation.releasedCredits}</Descriptions.Item>
              <Descriptions.Item label="状态"><StatusBadge status={job.reservation.status} /></Descriptions.Item>
            </Descriptions>
          ) : (
            <p className="text-gray-400 text-sm">无预留记录</p>
          )}
        </Card>

        <Card title="Attempts">
          {job.attempts.length === 0 ? (
            <div className="text-gray-400 text-sm">无尝试记录</div>
          ) : (
            <Table<AttemptItem>
              rowKey="id"
              columns={attemptColumns}
              dataSource={job.attempts}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </Card>

        <Card title="Outbox 投递记录">
          {job.outbox.length === 0 ? (
            <div className="text-gray-400 text-sm">无投递记录</div>
          ) : (
            <Table<OutboxItem>
              rowKey="id"
              columns={outboxColumns}
              dataSource={job.outbox}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </Card>

        <Card title="Usage Event">
          {job.usageEvent ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="估算 / 上报 / 最终">
                {fmtMicrousd(job.usageEvent.estimatedCostMicrousd)} · {fmtMicrousd(job.usageEvent.reportedCostMicrousd)} · {fmtMicrousd(job.usageEvent.finalCostMicrousd)}
              </Descriptions.Item>
              <Descriptions.Item label="成本状态 / 扣费 Credits">
                {job.usageEvent.costStatus} · <span className="text-cyan-600">{job.usageEvent.creditsCharged}</span>
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <p className="text-gray-400 text-sm">无用量事件</p>
          )}
        </Card>
      </div>
    </div>
  )
}
