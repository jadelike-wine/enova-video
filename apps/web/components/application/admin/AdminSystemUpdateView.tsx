'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Skeleton, Tag } from 'antd'
import { systemUpdateApi, type RollbackVersion, type SystemUpdateInfo, type SystemUpdateOperation } from '@/lib/api'
import { useDialog } from '../DialogProvider'
import { useSession } from '@/lib/auth'
import { formatErrorMessage } from '@/lib/errorMessage'

function dateText(value?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN')
}

export default function AdminSystemUpdateView() {
  const { alert, confirm } = useDialog()
  const { user } = useSession()
  const [info, setInfo] = useState<SystemUpdateInfo | null>(null)
  const [versions, setVersions] = useState<RollbackVersion[]>([])
  const [operation, setOperation] = useState<SystemUpdateOperation | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const current = await (force ? systemUpdateApi.check() : systemUpdateApi.status())
      setInfo(current)
      if (current.enabled) {
        const result = await systemUpdateApi.rollbackVersions()
        setVersions(result.versions)
      } else {
        setVersions([])
      }
    } catch (error) {
      await alert({ title: '加载失败', message: formatErrorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => {
    void load()
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  const watch = useCallback((started: SystemUpdateOperation) => {
    setOperation(started)
    if (timer.current) clearInterval(timer.current)
    const prevVersion = info?.current_version
    const startedAt = Date.now()
    // 轮询超时 15 分钟，与后端 UPDATE_EXEC_TIMEOUT_MS 保持一致
    const MAX_POLL_MS = 15 * 60 * 1000
    let consecutiveErrors = 0

    const resolveStale = async () => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
      setWorking(false)
      try {
        const current = await systemUpdateApi.check()
        setInfo(current)
        if (current.current_version !== prevVersion) {
          setOperation((prev) => (prev ? { ...prev, status: 'success', output: (prev.output || '') + '\n[auto-resolved] API 已重启，通过版本号变化确认更新成功' } : prev))
        } else {
          setOperation((prev) => (prev ? { ...prev, status: 'failed', output: (prev.output || '') + '\n[auto-resolved] 轮询超时，版本号未变化，更新可能未生效' } : prev))
          void alert({ title: '更新状态未知', message: '轮询超时，无法确认更新是否完成。请刷新页面检查当前版本。' })
        }
      } catch {
        setOperation((prev) => (prev ? { ...prev, status: 'failed', output: (prev.output || '') + '\n[auto-resolved] 轮询超时，无法获取当前版本' } : prev))
      }
    }

    timer.current = setInterval(() => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        void resolveStale()
        return
      }
      void systemUpdateApi.operation(started.operation_id)
        .then((next) => {
          consecutiveErrors = 0
          setOperation(next)
          if (next.status !== 'running' && timer.current) {
            clearInterval(timer.current)
            timer.current = null
            setWorking(false)
            if (next.status === 'failed') {
              void alert({ title: '更新失败', message: next.output?.trim() || '操作未能完成，请检查服务端日志' })
            }
          }
        })
        .catch(() => {
          consecutiveErrors++
          // API 重启期间连续失败是正常的，不中断轮询
          if (consecutiveErrors > 30) {
            // 连续失败超过 1 分钟，尝试通过版本号判断
            void resolveStale()
          }
        })
    }, 2000)
  }, [alert, info?.current_version])

  const runUpdate = useCallback(async (version?: string) => {
    const label = version ? `切换到版本 ${version}` : '更新到最新稳定版本'
    if (!await confirm({ title: '确认系统更新', message: `${label}。更新会重启 API、Worker 和 Web 容器，确定继续吗？`, confirmVariant: 'danger', confirmText: '开始更新' })) return
    setWorking(true)
    try {
      watch(await systemUpdateApi.update(version))
    } catch (error) {
      setWorking(false)
      await alert({ title: '启动更新失败', message: formatErrorMessage(error) })
    }
  }, [alert, confirm, watch])

  const runRollback = useCallback(async () => {
    if (!await confirm({ title: '确认回滚', message: '将回退到上一个成功版本，并重启服务。确定继续吗？', confirmVariant: 'danger', confirmText: '开始回滚' })) return
    setWorking(true)
    try {
      watch(await systemUpdateApi.rollback())
    } catch (error) {
      setWorking(false)
      await alert({ title: '启动回滚失败', message: formatErrorMessage(error) })
    }
  }, [alert, confirm, watch])

  if (user && user.role !== 'ADMIN') {
    return <div className="h-full flex items-center justify-center text-gray-500">仅管理员可访问系统更新</div>
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-gray-200 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">系统更新</h2>
        </div>
        <Button onClick={() => void load(true)} disabled={loading || working}>刷新检查</Button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {loading && (
          <div className="p-10">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        )}

        {!loading && info && (
          <>
            {!info.enabled && (
              <Alert
                type="warning"
                showIcon
                message="系统更新未启用"
                description="请在部署环境设置 UPDATE_ENABLED=true，并按部署文档挂载 Docker Socket 与仓库目录。"
              />
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Card title="当前版本">
                <p className="text-xl font-semibold text-gray-900 mt-1">{info.current_version}</p>
              </Card>
              <Card title="最新稳定版">
                <p className="text-xl font-semibold text-cyan-600 mt-1">{info.latest_version}</p>
              </Card>
              <Card title="状态">
                <p className={`text-xl font-semibold mt-1 ${info.has_update ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {info.has_update ? '有可用更新' : '已是最新'}
                </p>
              </Card>
            </div>

            {info.warning && <Alert type="warning" message={info.warning} />}

            <Card
              title="发布信息"
              extra={
                <Button type="primary" disabled={!info.enabled || working || !info.has_update} onClick={() => void runUpdate()}>
                  {working ? '执行中…' : '更新到最新版本'}
                </Button>
              }
            >
              {info.release_info ? (
                <>
                  <p className="text-gray-800">{info.release_info.name || info.latest_version}</p>
                  <p className="text-xs text-gray-400 mt-1">发布时间：{dateText(info.release_info.published_at)}</p>
                  <a className="text-xs text-cyan-600 hover:text-cyan-700 inline-block mt-3" href={info.release_info.html_url} target="_blank" rel="noreferrer">查看 GitHub Release ↗</a>
                </>
              ) : <p className="text-gray-400 text-sm">暂无发布说明</p>}
            </Card>

            {operation && (
              <Card
                title="最近操作"
                extra={
                  <Tag color={operation.status === 'failed' ? 'error' : operation.status === 'success' ? 'success' : 'processing'}>
                    {operation.status === 'running' ? '执行中' : operation.status === 'success' ? '已完成' : '失败'}
                  </Tag>
                }
              >
                <p className="text-xs text-gray-400 mt-2">
                  {operation.action === 'rollback' ? '回滚' : '更新'} {operation.target || '最新版本'} · {dateText(operation.started_at)}
                </p>
                <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-gray-100 p-4 text-xs text-gray-600 whitespace-pre-wrap">
                  {operation.output || '等待部署脚本输出…'}
                </pre>
              </Card>
            )}

            <Card
              title="历史版本"
              extra={
                <Button danger disabled={!info.enabled || working} onClick={() => void runRollback()}>
                  回滚上一个版本
                </Button>
              }
            >
              {versions.length === 0 ? (
                <p className="text-sm text-gray-400">暂无可回滚版本</p>
              ) : (
                <div className="space-y-2">
                  {versions.map((item) => (
                    <div key={item.version} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-100 px-4 py-3">
                      <div>
                        <code className="text-gray-800">{item.version}</code>
                        <p className="text-xs text-gray-400 mt-1">{dateText(item.published_at)}</p>
                      </div>
                      <Button size="small" disabled={working} onClick={() => void runUpdate(item.version)}>
                        切换到此版本
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
