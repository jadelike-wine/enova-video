'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Skeleton, Tag, message } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { systemUpdateApi, type RollbackVersion, type SystemUpdateInfo, type SystemUpdateOperation } from '@/lib/api'
import { useDialog } from '../DialogProvider'
import { useSession } from '@/lib/auth'
import { formatErrorMessage } from '@/lib/errorMessage'
import { buildSuccessMessage } from '@/lib/system-update-logic'
import { CopyBox } from './CopyBox'

// ---------------------------------------------------------------------------
// sessionStorage 键：更新成功后标记自动刷新
// 写入后触发 window.location.reload()，刷新后读取并消费（删除），
// 避免重复刷新或数据丢失。消费标记后自动触发 force-check 加载最新版本。
// ---------------------------------------------------------------------------
const RELOAD_FLAG_KEY = 'sys_update_pending_reload'

interface PendingReload {
  /** 目标版本号，刷新后用于验证 */  targetVersion?: string
  /** 操作类型，用于成功通知文案 */
  action: 'update' | 'rollback'
  /** 写入时间戳，超时自动失效（5 分钟） */
  ts: number
}

const PENDING_TTL_MS = 5 * 60 * 1000

function readPendingReload(): PendingReload | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_FLAG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingReload
    if (Date.now() - parsed.ts > PENDING_TTL_MS) {
      sessionStorage.removeItem(RELOAD_FLAG_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writePendingReload(pending: PendingReload): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG_KEY, JSON.stringify(pending))
  } catch {
    // sessionStorage 不可用时静默降级
  }
}

function clearPendingReload(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG_KEY)
  } catch {
    // ignore
  }
}

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
  const logRef = useRef<HTMLPreElement | null>(null)
  const successNotifiedRef = useRef(false)
  // 当前操作的 action 类型，用于区分「更新」和「回滚」通知文案
  const actionRef = useRef<'update' | 'rollback'>('update')
  // 防止重复触发 reload 的幂等标记
  const reloadTriggeredRef = useRef(false)
  // 刷新后展示的成功提示内容（release body）
  const [releaseBody, setReleaseBody] = useState<string>('')
  // 发布信息区域折叠状态：默认收起
  const [releaseInfoExpanded, setReleaseInfoExpanded] = useState(false)

  // ------------------------------------------------------------------
  // 统一成功通知：根据 action 选择正确动词，避免回滚被误标为「更新」
  // ------------------------------------------------------------------
  const notifySuccess = useCallback((versionLabel?: string) => {
    if (successNotifiedRef.current) return
    successNotifiedRef.current = true
    message.success(buildSuccessMessage(actionRef.current, versionLabel))
  }, [])

  // ------------------------------------------------------------------
  // 日志自动滚动：operation.output 变化后将 <pre> 滚动到底部
  // ------------------------------------------------------------------
  useEffect(() => {
    const el = logRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [operation?.output])

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

  // ------------------------------------------------------------------
  // 页面加载时检查是否有「更新成功后待刷新」标记
  // 如果存在且未过期：消费标记 → 强制刷新版本 → 展示成功通知
  // 这确保刷新后展示最新版本内容，且不会重复加载
  // ------------------------------------------------------------------
  useEffect(() => {
    const pending = readPendingReload()
    if (pending) {
      clearPendingReload()
      actionRef.current = pending.action
      // 强制刷新获取最新版本信息
      void load(true).then(() => {
        message.success(buildSuccessMessage(pending.action, pending.targetVersion))
      })
    } else {
      void load()
    }
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  // ------------------------------------------------------------------
  // 更新成功后刷新版本信息（局部刷新，不 reload 整页）
  // ------------------------------------------------------------------
  const refreshAfterSuccess = useCallback(async (newVersion?: string) => {
    try {
      const fresh = await systemUpdateApi.check()
      setInfo(fresh)
      // 保存 release body 供 CopyBox 展示
      if (fresh.release_info?.body) {
        setReleaseBody(fresh.release_info.body)
      }
      if (fresh.enabled) {
        try {
          const result = await systemUpdateApi.rollbackVersions()
          setVersions(result.versions)
        } catch {
          // rollback-versions 失败不阻塞成功流程
        }
      }
      // 如果通过版本号检测到操作成功，给用户明确提示
      if (newVersion && fresh.current_version === newVersion) {
        notifySuccess(fresh.current_version)
      }
    } catch {
      // 版本刷新失败不影响 operation 状态判定
    }
  }, [notifySuccess])

  // ------------------------------------------------------------------
  // 更新成功后自动刷新页面：
  // 1. 写入 sessionStorage 标记（包含目标版本、操作类型、时间戳）
  // 2. 延迟 1.5s 后 window.location.reload()（让用户看到成功通知）
  // 3. 刷新后组件重新挂载，读取标记 → 强制 check → 展示最新版本
  // 使用 reloadTriggeredRef 保证只触发一次，避免重复加载
  // ------------------------------------------------------------------
  const triggerAutoReload = useCallback((targetVersion?: string) => {
    if (reloadTriggeredRef.current) return
    reloadTriggeredRef.current = true
    writePendingReload({
      targetVersion,
      action: actionRef.current,
      ts: Date.now(),
    })
    setTimeout(() => {
      window.location.reload()
    }, 1500)
  }, [])

  // ------------------------------------------------------------------
  // 通过版本号变化判断更新是否成功（服务重启后 operation 可能丢失）
  // ------------------------------------------------------------------
  const checkVersionSuccess = useCallback(async (prevVersion: string, targetVersion?: string): Promise<boolean> => {
    try {
      const fresh = await systemUpdateApi.check()
      // 目标版本已知且当前版本已达到目标
      if (targetVersion && fresh.current_version === targetVersion) {
        setInfo(fresh)
        if (fresh.enabled) {
          try {
            const result = await systemUpdateApi.rollbackVersions()
            setVersions(result.versions)
          } catch {
            // ignore
          }
        }
        notifySuccess(fresh.current_version)
        return true
      }
      // 目标版本未知但版本号已变化
      if (!targetVersion && fresh.current_version !== prevVersion) {
        setInfo(fresh)
        if (fresh.enabled) {
          try {
            const result = await systemUpdateApi.rollbackVersions()
            setVersions(result.versions)
          } catch {
            // ignore
          }
        }
        notifySuccess(fresh.current_version)
        return true
      }
      return false
    } catch {
      return false
    }
  }, [notifySuccess])

  // ------------------------------------------------------------------
  // 停止轮询并清理
  // ------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    setWorking(false)
  }, [])

  // ------------------------------------------------------------------
  // 轮询监听更新操作
  // ------------------------------------------------------------------
  const watch = useCallback((started: SystemUpdateOperation) => {
    setOperation(started)
    successNotifiedRef.current = false
    actionRef.current = started.action || 'update'
    if (timer.current) clearInterval(timer.current)
    const prevVersion = info?.current_version
    const startedAt = Date.now()
    const targetVersion = started.target
    // 轮询超时 15 分钟，与后端 UPDATE_EXEC_TIMEOUT_MS 保持一致
    const MAX_POLL_MS = 15 * 60 * 1000
    let consecutiveErrors = 0
    // 连续检测到 running 状态的次数（用于触发版本号检测）
    let runningSinceSuccess = 0

    const resolveStale = async () => {
      stopPolling()
      try {
        const current = await systemUpdateApi.check()
        setInfo(current)
        if (current.current_version !== prevVersion) {
          setOperation((prev) => (prev ? { ...prev, status: 'success', output: (prev.output || '') + '\n[auto-resolved] API 已重启，通过版本号变化确认操作成功' } : prev))
          notifySuccess(current.current_version)
          // 自动刷新整页
          triggerAutoReload(current.current_version)
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
          if (next.status === 'success') {
            stopPolling()
            const versionLabel = targetVersion || next.target || info?.latest_version
            notifySuccess(versionLabel)
            // 局部刷新版本信息（获取最新 release body 等）
            void refreshAfterSuccess(targetVersion || next.target || undefined).then(() => {
              // 自动刷新整页，确保所有前端资源（JS/CSS）也更新到最新版本
              triggerAutoReload(versionLabel)
            })
          } else if (next.status === 'failed') {
            stopPolling()
            void alert({ title: '更新失败', message: next.output?.trim() || '操作未能完成，请检查服务端日志' })
          } else if (next.status === 'running') {
            // 后端仍为 running：累加计数，连续 10 次（约 20s）后尝试版本号检测
            // 这覆盖 "API 重启导致 executor 被杀但脚本已成功" 的场景
            runningSinceSuccess++
            if (runningSinceSuccess >= 10) {
              runningSinceSuccess = 0 // 避免重复触发，失败则继续等
              void checkVersionSuccess(prevVersion || '', targetVersion).then((ok) => {
                if (ok) {
                  stopPolling()
                  setOperation((prev) => (prev ? { ...prev, status: 'success', output: (prev.output || '') + '\n[auto-resolved] 通过版本号变化确认更新成功' } : prev))
                  // 自动刷新整页
                  triggerAutoReload(targetVersion || undefined)
                }
              })
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
  }, [alert, info?.current_version, info?.latest_version, stopPolling, refreshAfterSuccess, checkVersionSuccess, notifySuccess, triggerAutoReload])

  const runUpdate = useCallback(async (version?: string) => {
    if (working) return // 防止连续点击
    const label = version ? `切换到版本 ${version}` : '更新到最新稳定版本'
    if (!await confirm({ title: '确认系统更新', message: `${label}。更新会重启 API、Worker 和 Web 容器，确定继续吗？`, confirmVariant: 'danger', confirmText: '开始更新' })) return
    setWorking(true)
    successNotifiedRef.current = false
    try {
      watch(await systemUpdateApi.update(version))
    } catch (error) {
      setWorking(false)
      await alert({ title: '启动更新失败', message: formatErrorMessage(error) })
    }
  }, [alert, confirm, watch, working])

  const runRollback = useCallback(async () => {
    if (working) return // 防止连续点击
    if (!await confirm({ title: '确认回滚', message: '将回退到上一个成功版本，并重启服务。确定继续吗？', confirmVariant: 'danger', confirmText: '开始回滚' })) return
    setWorking(true)
    successNotifiedRef.current = false
    try {
      watch(await systemUpdateApi.rollback())
    } catch (error) {
      setWorking(false)
      await alert({ title: '启动回滚失败', message: formatErrorMessage(error) })
    }
  }, [alert, confirm, watch, working])

  // 页面卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  if (user && user.role !== 'ADMIN') {
    return <div className="h-full flex items-center justify-center text-gray-500">仅管理员可访问系统更新</div>
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-gray-100 flex items-center justify-between gap-4">
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

            {/* 更新成功后展示 release body 复制框 */}
            {releaseBody && (
              <CopyBox
                label="更新日志"
                description={
                  <span>
                    版本 <code className="text-cyan-600">{info.current_version}</code> 的更新内容，可一键复制。
                  </span>
                }
                value={releaseBody}
                collapsible
                onCopied={() => message.success('已复制更新日志')}
              />
            )}

            <Card
              title={
                <div
                  className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={() => setReleaseInfoExpanded((v) => !v)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setReleaseInfoExpanded((v) => !v)
                    }
                  }}
                >
                  <span>发布信息</span>
                  {releaseInfoExpanded
                    ? <UpOutlined className="text-gray-400 text-xs" />
                    : <DownOutlined className="text-gray-400 text-xs" />}
                </div>
              }
              extra={
                <Button type="primary" disabled={!info.enabled || working || !info.has_update} onClick={() => void runUpdate()}>
                  {working ? '执行中…' : '更新到最新版本'}
                </Button>
              }
            >
              {releaseInfoExpanded && (
                info.release_info ? (
                  <>
                    <p className="text-gray-800">{info.release_info.name || info.latest_version}</p>
                    <p className="text-xs text-gray-400 mt-1">发布时间：{dateText(info.release_info.published_at)}</p>
                    <a className="text-xs text-cyan-600 hover:text-cyan-700 inline-block mt-3" href={info.release_info.html_url} target="_blank" rel="noreferrer">查看 GitHub Release ↗</a>
                    {/* 展示 release body 并提供一键复制 */}
                    {info.release_info.body && (
                      <div className="mt-4">
                        <CopyBox
                          label="发布说明"
                          description="点击右侧按钮一键复制发布说明内容"
                          value={info.release_info.body}
                          onCopied={() => message.success('已复制发布说明')}
                        />
                      </div>
                    )}
                  </>
                ) : <p className="text-gray-400 text-sm">暂无发布说明</p>
              )}
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
                <pre ref={logRef} className="mt-4 max-h-64 overflow-auto rounded-xl bg-gray-100 p-4 text-xs text-gray-600 whitespace-pre-wrap">
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
                    <div key={item.version} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-100 px-4 py-3">
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
