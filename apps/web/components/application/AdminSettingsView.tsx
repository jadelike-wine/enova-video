'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  settingsApi,
  type SettingView,
  type SettingHistoryEntry,
} from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'

const GROUP_LABEL: Record<string, string> = {
  billing: '基础业务',
  auth: '认证',
  payment: '支付',
  queue: '任务 / 视频',
  storage: '对象存储',
  security: '安全 / SSRF',
  log: '日志 / 可观测性',
  general: '通用',
}

const GROUP_ORDER = ['billing', 'auth', 'payment', 'queue', 'storage', 'security', 'log', 'general']

function groupLabel(group: string): string {
  return GROUP_LABEL[group] || group
}

export default function AdminSettingsView() {
  const { alert, confirm } = useDialog()
  const { user } = useSession()

  const [settings, setSettings] = useState<SettingView[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<SettingHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const items = await settingsApi.list()
      setSettings(items)
      const d: Record<string, string> = {}
      for (const s of items) {
        // Secret 已配置时，draft 留空（用户需要重新输入完整值才能修改）
        d[s.key] = s.isSecret && s.configured ? '' : s.value
      }
      setDrafts(d)
    } catch (e) {
      setSettings([])
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = useCallback(
    async (key: string) => {
      const setting = settings.find((s) => s.key === key)
      if (!setting) return
      const value = (drafts[key] ?? '').trim()

      // Secret 留空 = 保持不变（不调用 API）
      if (setting.isSecret && value === '') {
        await alert({ title: '提示', message: 'Secret 留空表示保持不变，未做修改' })
        return
      }

      setSaving((p) => ({ ...p, [key]: true }))
      try {
        const updated = await settingsApi.update(key, value)
        setSettings((prev) =>
          prev.map((s) =>
            s.key === key
              ? { ...s, value: updated.value, persisted: true, configured: updated.configured }
              : s,
          ),
        )
        // Secret 保存后清空 draft（下次修改需要重新输入）
        setDrafts((p) => ({ ...p, [key]: updated.isSecret && updated.configured ? '' : updated.value }))
        await alert({ title: '已保存', message: setting.restartRequired ? '配置已更新，但需要重启服务才能生效' : '配置已更新并实时生效' })
      } catch (e) {
        await alert({ title: '保存失败', message: formatErrorMessage(e) })
      } finally {
        setSaving((p) => ({ ...p, [key]: false }))
      }
    },
    [drafts, settings, alert],
  )

  const handleClearSecret = useCallback(
    async (key: string) => {
      const ok = await confirm({
        title: '清除 Secret',
        message: `确定清除 ${key} 的 Secret 值吗？此操作不可撤销，可能影响相关功能。`,
      })
      if (!ok) return
      setSaving((p) => ({ ...p, [key]: true }))
      try {
        const updated = await settingsApi.clearSecret(key)
        setSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, value: '', configured: false, persisted: true } : s)),
        )
        setDrafts((p) => ({ ...p, [key]: '' }))
        await alert({ title: '已清除', message: 'Secret 已清除' })
      } catch (e) {
        await alert({ title: '清除失败', message: formatErrorMessage(e) })
      } finally {
        setSaving((p) => ({ ...p, [key]: false }))
      }
    },
    [confirm, alert],
  )

  const handleBatchSave = useCallback(
    async (group: string) => {
      const groupSettings = settings.filter((s) => s.group === group)
      const dirtyItems: Array<{ key: string; value: string }> = []
      for (const s of groupSettings) {
        const draft = (drafts[s.key] ?? '').trim()
        // Secret 留空 = 保持不变，跳过
        if (s.isSecret && draft === '') continue
        if (draft !== s.value) {
          dirtyItems.push({ key: s.key, value: draft })
        }
      }
      if (dirtyItems.length === 0) {
        await alert({ title: '提示', message: '没有需要保存的修改' })
        return
      }
      setSaving((p) => ({ ...p, [`batch:${group}`]: true }))
      try {
        const updated = await settingsApi.batchUpdate(dirtyItems)
        setSettings(updated)
        const d: Record<string, string> = {}
        for (const s of updated) {
          d[s.key] = s.isSecret && s.configured ? '' : s.value
        }
        setDrafts((prev) => ({ ...prev, ...d }))
        await alert({ title: '已保存', message: `${dirtyItems.length} 项配置已批量更新` })
      } catch (e) {
        await alert({ title: '批量保存失败', message: formatErrorMessage(e) })
      } finally {
        setSaving((p) => ({ ...p, [`batch:${group}`]: false }))
      }
    },
    [drafts, settings, alert],
  )

  const loadHistory = useCallback(
    async (key: string) => {
      setHistoryLoading(true)
      try {
        const entries = await settingsApi.history(key)
        setHistory(entries)
        setHistoryFor(key)
      } catch (e) {
        await alert({ title: '历史加载失败', message: formatErrorMessage(e) })
      } finally {
        setHistoryLoading(false)
      }
    },
    [alert],
  )

  /** 非 ADMIN 用户不允许进入（后端已拦截，前端仅提示）。 */
  if (user && user.role !== 'ADMIN') {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-white/50">仅管理员可访问系统配置</p>
      </div>
    )
  }

  const grouped = () => {
    const keys = [
      ...GROUP_ORDER.filter((g) => settings.some((s) => s.group === g)),
      ...settings.map((s) => s.group).filter((g, i, a) => !GROUP_ORDER.includes(g) && a.indexOf(g) === i),
    ]
    return keys.map((g) => ({ group: g, items: settings.filter((s) => s.group === g) }))
  }

  const hasGroupDirty = (group: string): boolean => {
    return settings
      .filter((s) => s.group === group)
      .some((s) => {
        const draft = (drafts[s.key] ?? '').trim()
        if (s.isSecret && draft === '') return false
        return draft !== s.value
      })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-white/10 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
            系统配置
          </h2>
          <p className="text-sm text-white/50 mt-1">
            动态配置立即生效，无需重启服务；未修改的项回退到环境变量/默认值
          </p>
        </div>
        <button className="btn-secondary text-sm" onClick={() => void load()} disabled={loading}>
          刷新
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {loading && <div className="text-center py-16 text-white/40">加载中…</div>}

        {!loading && settings.length === 0 && (
          <div className="text-center py-16 text-white/40">暂无配置项</div>
        )}

        {!loading &&
          grouped().map(({ group, items }) => {
            const groupDirty = hasGroupDirty(group)
            const isSecurityGroup = group === 'security'
            return (
              <section key={group} className="glass-card">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">{groupLabel(group)}</h3>
                    {isSecurityGroup && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                        高风险
                      </span>
                    )}
                  </div>
                  {groupDirty && (
                    <button
                      className="btn-primary text-xs disabled:opacity-50"
                      disabled={saving[`batch:${group}`]}
                      onClick={() => void handleBatchSave(group)}
                    >
                      {saving[`batch:${group}`] ? '保存中…' : '批量保存'}
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  {items.map((setting) => {
                    const isDirty = (() => {
                      const draft = (drafts[setting.key] ?? '').trim()
                      if (setting.isSecret && draft === '') return false
                      return draft !== setting.value
                    })()
                    return (
                      <div
                        key={setting.key}
                        className={`rounded-2xl border bg-black/20 p-4 ${
                          isSecurityGroup ? 'border-red-500/20' : 'border-white/10'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-white/90 font-medium">{setting.label}</p>
                              {setting.persisted && (
                                <span className="badge text-[10px]">已覆盖</span>
                              )}
                              {setting.isSecret && setting.configured && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">
                                  已配置
                                </span>
                              )}
                              {setting.isSecret && !setting.configured && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                                  未配置
                                </span>
                              )}
                              {setting.restartRequired && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                                  需重启
                                </span>
                              )}
                              {setting.permission === 'settings.security_write' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">
                                  需超管
                                </span>
                              )}
                            </div>
                            {setting.description && (
                              <p className="text-xs text-white/40 mt-0.5">{setting.description}</p>
                            )}
                            {setting.isSecret && (
                              <p className="text-[10px] text-amber-300/70 mt-1">
                                {setting.configured
                                  ? '已加密存储，留空保持不变，输入新值覆盖'
                                  : '敏感字段，AES-GCM 加密存储'}
                              </p>
                            )}
                            {isSecurityGroup && (
                              <p className="text-[10px] text-red-300/70 mt-1">
                                ⚠ 降低安全边界可能引入 SSRF/内网访问风险
                              </p>
                            )}
                          </div>
                          <code className="text-[10px] text-white/30 flex-shrink-0 mt-1">
                            {setting.key}
                          </code>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 mt-3">
                          {setting.valueType === 'boolean' ? (
                            <label className="flex items-center gap-2 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                checked={drafts[setting.key] === 'true'}
                                onChange={(e) =>
                                  setDrafts((p) => ({ ...p, [setting.key]: e.target.checked ? 'true' : 'false' }))
                                }
                                className="w-4 h-4 rounded"
                              />
                              <span className="text-sm text-white/60">
                                {drafts[setting.key] === 'true' ? '启用' : '禁用'}
                              </span>
                            </label>
                          ) : setting.valueType === 'enum' && setting.options ? (
                            <select
                              value={drafts[setting.key] ?? ''}
                              onChange={(e) => setDrafts((p) => ({ ...p, [setting.key]: e.target.value }))}
                              className="input-field flex-1"
                            >
                              {setting.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={drafts[setting.key] ?? ''}
                              onChange={(e) => setDrafts((p) => ({ ...p, [setting.key]: e.target.value }))}
                              type={setting.valueType === 'number' ? 'number' : setting.isSecret ? 'password' : 'text'}
                              className="input-field flex-1"
                              placeholder={
                                setting.isSecret && setting.configured
                                  ? '••••••（留空保持不变）'
                                  : ''
                              }
                              {...(setting.valueType === 'number' && setting.min !== undefined
                                ? { min: setting.min }
                                : {})}
                              {...(setting.valueType === 'number' && setting.max !== undefined
                                ? { max: setting.max }
                                : {})}
                            />
                          )}
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              className="btn-primary text-sm disabled:opacity-50"
                              disabled={saving[setting.key] || !isDirty}
                              onClick={() => void handleSave(setting.key)}
                            >
                              {saving[setting.key] ? '…' : isDirty ? '保存' : '已是最新'}
                            </button>
                            {setting.isSecret && setting.configured && (
                              <button
                                className="btn-secondary text-sm text-red-300 disabled:opacity-50"
                                disabled={saving[setting.key]}
                                onClick={() => void handleClearSecret(setting.key)}
                                title="清除 Secret"
                              >
                                清除
                              </button>
                            )}
                            <button
                              className="btn-secondary text-sm"
                              onClick={() => void loadHistory(setting.key)}
                              title="变更历史"
                            >
                              历史
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
      </div>

      {/* 变更历史弹层 */}
      {historyFor && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setHistoryFor(null)}
        >
          <div
            className="glass-card max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">变更历史：{historyFor}</h3>
              <button className="btn-secondary text-sm" onClick={() => setHistoryFor(null)}>
                关闭
              </button>
            </div>
            {historyLoading ? (
              <div className="text-center py-8 text-white/40">加载中…</div>
            ) : history.length === 0 ? (
              <div className="text-center py-8 text-white/40">暂无变更记录</div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-white/80">v{h.version}</span>
                      <span className="text-[10px] text-white/40">{new Date(h.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                      {h.reason && <span>原因：{h.reason}</span>}
                      {h.updatedBy && <span> 操作者：{h.updatedBy}</span>}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5 font-mono">
                      {h.before ? '[REDACTED]' : '(空)'} → {h.after ? '[REDACTED]' : '(空)'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
