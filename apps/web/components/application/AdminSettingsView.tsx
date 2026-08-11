'use client'

import { useCallback, useEffect, useState } from 'react'
import { settingsApi, type SettingView } from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'

const GROUP_LABEL: Record<string, string> = {
  billing: '计费',
  auth: '认证',
  payment: '支付',
  queue: '任务 / 视频',
  storage: '下载 / SSRF',
  log: '日志',
  general: '通用',
}

function groupLabel(group: string): string {
  return GROUP_LABEL[group] || group
}

export default function AdminSettingsView() {
  const { alert } = useDialog()
  const { user } = useSession()

  const [settings, setSettings] = useState<SettingView[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const items = await settingsApi.list()
      setSettings(items)
      const d: Record<string, string> = {}
      for (const s of items) d[s.key] = s.value
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
      const value = (drafts[key] ?? '').trim()
      setSaving((p) => ({ ...p, [key]: true }))
      try {
        const updated = await settingsApi.update(key, value)
        setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value: updated.value, persisted: true } : s)))
        setDrafts((p) => ({ ...p, [key]: updated.value }))
        await alert({ title: '已保存', message: '配置已更新并实时生效' })
      } catch (e) {
        await alert({ title: '保存失败', message: formatErrorMessage(e) })
      } finally {
        setSaving((p) => ({ ...p, [key]: false }))
      }
    },
    [drafts, alert],
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
    const order = ['billing', 'auth', 'payment', 'queue', 'storage', 'log']
    const keys = [
      ...order.filter((g) => settings.some((s) => s.group === g)),
      ...settings.map((s) => s.group).filter((g, i, a) => !order.includes(g) && a.indexOf(g) === i),
    ]
    return keys.map((g) => ({ group: g, items: settings.filter((s) => s.group === g) }))
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
          grouped().map(({ group, items }) => (
            <section key={group} className="glass-card">
              <h3 className="text-lg font-bold text-white mb-4">{groupLabel(group)}</h3>
              <div className="space-y-4">
                {items.map((setting) => {
                  const isDirty = (drafts[setting.key] ?? '') !== setting.value
                  return (
                    <div
                      key={setting.key}
                      className="rounded-2xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-white/90 font-medium">{setting.label}</p>
                            {setting.persisted && (
                              <span className="badge text-[10px]">已覆盖</span>
                            )}
                          </div>
                          {setting.description && (
                            <p className="text-xs text-white/40 mt-0.5">{setting.description}</p>
                          )}
                          {setting.isSecret && (
                            <p className="text-[10px] text-amber-300/70 mt-1">敏感字段，保存时请填写完整值</p>
                          )}
                        </div>
                        <code className="text-[10px] text-white/30 flex-shrink-0 mt-1">
                          {setting.key}
                        </code>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2 mt-3">
                        {setting.valueType === 'enum' && setting.options ? (
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
                            placeholder={setting.isSecret && setting.value ? '••••••（留空保持不变）' : ''}
                          />
                        )}
                        <button
                          className="btn-primary flex-shrink-0 disabled:opacity-50"
                          disabled={saving[setting.key] || !isDirty}
                          onClick={() => void handleSave(setting.key)}
                        >
                          {saving[setting.key] ? '保存中…' : isDirty ? '保存' : '已是最新'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
      </div>
    </div>
  )
}