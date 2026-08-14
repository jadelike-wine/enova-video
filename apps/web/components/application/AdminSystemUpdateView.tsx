'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { systemUpdateApi, type RollbackVersion, type SystemUpdateInfo, type SystemUpdateOperation } from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'

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
    timer.current = setInterval(() => {
      void systemUpdateApi.operation(started.operation_id)
        .then((next) => {
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
        .catch(() => undefined)
    }, 2000)
  }, [alert])

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
        <button className="btn-secondary text-sm" onClick={() => void load(true)} disabled={loading || working}>刷新检查</button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {loading && <div className="text-center py-16 text-gray-400">加载中…</div>}

        {!loading && info && (
          <>
            {!info.enabled && (
              <div className="glass-card border border-amber-300/20 text-amber-600 text-sm">
                系统更新未启用。请在部署环境设置 <code>UPDATE_ENABLED=true</code>，并按部署文档挂载 Docker Socket 与仓库目录。
              </div>
            )}

            <section className="glass-card grid grid-cols-1 md:grid-cols-3 gap-5">
              <div><p className="text-xs text-gray-400">当前版本</p><p className="text-xl font-semibold text-gray-900 mt-1">{info.current_version}</p></div>
              <div><p className="text-xs text-gray-400">最新稳定版</p><p className="text-xl font-semibold text-cyan-600 mt-1">{info.latest_version}</p></div>
              <div><p className="text-xs text-gray-400">状态</p><p className={`text-xl font-semibold mt-1 ${info.has_update ? 'text-amber-600' : 'text-emerald-600'}`}>{info.has_update ? '有可用更新' : '已是最新'}</p></div>
            </section>

            {info.warning && <p className="text-sm text-amber-600">{info.warning}</p>}

            <section className="glass-card">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div><h3 className="text-lg font-bold text-gray-900">发布信息</h3><p className="text-xs text-gray-400 mt-1">{info.cached ? '来自 Redis 缓存' : '刚刚从 GitHub 获取'}</p></div>
                <button className="btn-primary text-sm" disabled={!info.enabled || working || !info.has_update} onClick={() => void runUpdate()}>{working ? '执行中…' : '更新到最新版本'}</button>
              </div>
              {info.release_info ? <><p className="text-gray-800">{info.release_info.name || info.latest_version}</p><p className="text-xs text-gray-400 mt-1">发布时间：{dateText(info.release_info.published_at)}</p><a className="text-xs text-cyan-600 hover:text-cyan-700 inline-block mt-3" href={info.release_info.html_url} target="_blank" rel="noreferrer">查看 GitHub Release ↗</a></> : <p className="text-gray-400 text-sm">暂无发布说明</p>}
            </section>

            <section className="glass-card">
              <div className="flex items-center justify-between mb-4"><div><h3 className="text-lg font-bold text-gray-900">历史版本</h3><p className="text-xs text-gray-400 mt-1">可切换到最近的稳定版本</p></div><button className="btn-danger text-sm" disabled={!info.enabled || working} onClick={() => void runRollback()}>回滚上一个版本</button></div>
              {versions.length === 0 ? <p className="text-sm text-gray-400">暂无可回滚版本</p> : <div className="space-y-2">{versions.map((item) => <div key={item.version} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-100 px-4 py-3"><div><code className="text-gray-800">{item.version}</code><p className="text-xs text-gray-400 mt-1">{dateText(item.published_at)}</p></div><button className="btn-secondary text-xs" disabled={working} onClick={() => void runUpdate(item.version)}>切换到此版本</button></div>)}</div>}
            </section>

            {operation && <section className="glass-card"><div className="flex items-center justify-between"><h3 className="text-lg font-bold text-gray-900">最近操作</h3><span className={`badge ${operation.status === 'failed' ? 'text-red-600' : operation.status === 'success' ? 'text-emerald-600' : 'text-amber-600'}`}>{operation.status === 'running' ? '执行中' : operation.status === 'success' ? '已完成' : '失败'}</span></div><p className="text-xs text-gray-400 mt-2">{operation.action === 'rollback' ? '回滚' : '更新'} {operation.target || '最新版本'} · {dateText(operation.started_at)}</p><pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-gray-100 p-4 text-xs text-gray-600 whitespace-pre-wrap">{operation.output || '等待部署脚本输出…'}</pre></section>}
          </>
        )}
      </div>
    </div>
  )
}
