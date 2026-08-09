'use client'

import { useCallback, useEffect, useState } from 'react'
import { settingsApi } from '../../lib/api'
import { useDialog } from './DialogProvider'

interface KeyStatus {
  has_active_key: boolean
  has_qiniu_config: boolean
  key_count: number
  agnes_base_url: string
  default_agnes_base_url: string
}

interface ApiKeyItem {
  id: number
  name: string
  api_key?: string
  key_masked?: string
  is_active: boolean
  created_at?: string
}

interface ApiKeyList {
  items: ApiKeyItem[]
}

export default function SettingsView() {
  const { confirm, alert } = useDialog()

  const [keys, setKeys] = useState<ApiKeyItem[]>([])
  const [status, setStatus] = useState<KeyStatus>({
    has_active_key: false,
    has_qiniu_config: false,
    key_count: 0,
    agnes_base_url: '',
    default_agnes_base_url: '',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingBaseUrl, setSavingBaseUrl] = useState(false)

  const [baseUrlForm, setBaseUrlForm] = useState('')
  const [defaultBaseUrl, setDefaultBaseUrl] = useState('https://apihub.agnes-ai.com')

  const [form, setForm] = useState({ name: '', api_key: '', activate: true })

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ name: '', api_key: '' })

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const [statusData, keysData] = await Promise.all([
        settingsApi.getStatus(),
        settingsApi.listApiKeys(),
      ])
      const st = statusData as KeyStatus
      const ks = keysData as ApiKeyList
      setStatus(st)
      setKeys(ks.items)
      setBaseUrlForm(st.agnes_base_url || '')
      setDefaultBaseUrl(st.default_agnes_base_url || 'https://apihub.agnes-ai.com')
    } catch (e) {
      await alert({ title: '加载失败', message: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => {
    loadKeys()
  }, [loadKeys])

  const handleSaveBaseUrl = async () => {
    const url = baseUrlForm.trim()
    if (!url) {
      await alert({ title: '提示', message: '请填写 API Base URL' })
      return
    }
    setSavingBaseUrl(true)
    try {
      const data = (await settingsApi.updateBaseUrl(url)) as { base_url: string }
      setBaseUrlForm(data.base_url)
      setStatus((prev) => ({ ...prev, agnes_base_url: data.base_url }))
      await alert({ title: '已保存', message: 'API Base URL 已更新' })
    } catch (e) {
      await alert({ title: '保存失败', message: (e as Error).message })
    } finally {
      setSavingBaseUrl(false)
    }
  }

  const resetBaseUrl = () => {
    setBaseUrlForm(defaultBaseUrl)
  }

  const handleCreate = async () => {
    const name = form.name.trim()
    const apiKey = form.api_key.trim()
    if (!name || !apiKey) {
      await alert({ title: '提示', message: '请填写名称和 API Key' })
      return
    }
    setSaving(true)
    try {
      await settingsApi.createApiKey({
        name,
        api_key: apiKey,
        activate: form.activate,
      })
      setForm({ name: '', api_key: '', activate: true })
      await loadKeys()
    } catch (e) {
      await alert({ title: '添加失败', message: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (id: number) => {
    try {
      await settingsApi.activateApiKey(id)
      await loadKeys()
    } catch (e) {
      await alert({ title: '启用失败', message: (e as Error).message })
    }
  }

  const handleDelete = async (item: ApiKeyItem) => {
    const ok = await confirm({
      title: '删除 API Key',
      message: `确定删除「${item.name}」吗？此操作不可恢复。`,
      confirmText: '删除',
      confirmVariant: 'danger',
    })
    if (!ok) return
    try {
      await settingsApi.deleteApiKey(item.id)
      await loadKeys()
    } catch (e) {
      await alert({ title: '删除失败', message: (e as Error).message })
    }
  }

  const startEdit = (item: ApiKeyItem) => {
    setEditingId(item.id)
    setEditForm({ name: item.name, api_key: '' })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({ name: '', api_key: '' })
  }

  const handleSaveEdit = async (id: number) => {
    const payload: Record<string, string> = {}
    const name = editForm.name.trim()
    const apiKey = editForm.api_key.trim()
    if (!name) {
      await alert({ title: '提示', message: '名称不能为空' })
      return
    }
    payload.name = name
    if (apiKey) payload.api_key = apiKey
    try {
      await settingsApi.updateApiKey(id, payload)
      cancelEdit()
      await loadKeys()
    } catch (e) {
      await alert({ title: '保存失败', message: (e as Error).message })
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-white/10">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
          设置
        </h2>
        <p className="text-sm text-white/50 mt-1">管理 Agnes AI 连接配置与对象存储状态</p>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {/* 状态提示 */}
        {!loading && !status.has_active_key && (
          <div className="glass-card border border-amber-400/30 bg-amber-400/10">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-semibold text-amber-200">尚未启用 API Key</p>
                <p className="text-sm text-white/60 mt-1">
                  请先在
                  <a
                    href="https://platform.agnes-ai.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300 hover:underline"
                  >
                    {' '}Agnes AI 平台
                  </a>
                  {' '}注册账号并创建 API Key，然后在下方添加并启用，否则无法使用对话、图片和视频生成功能。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 对象存储 */}
        <section id="storage" className="glass-card scroll-mt-6">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h3 className="text-lg font-bold text-white">对象存储（七牛云）</h3>
            {!loading && (
              <span
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  status.has_qiniu_config
                    ? 'border-emerald-400/40 text-emerald-200 bg-emerald-400/10'
                    : 'border-amber-400/40 text-amber-200 bg-amber-400/10'
                }`}
              >
                {status.has_qiniu_config ? '已配置' : '未配置'}
              </span>
            )}
          </div>
          <p className="text-sm text-white/50 mb-4">
            七牛云用于上传参考图片，并将生成结果持久化到 CDN。未配置时仍可使用文生图、文生视频，但带参考图的模式不可用，历史媒体链接可能过期。
          </p>

          {!loading && !status.has_qiniu_config && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 mb-4">
              <p className="text-sm text-amber-100/90 font-medium">如何配置</p>
              <ol className="text-sm text-white/60 mt-2 space-y-1.5 list-decimal list-inside">
                <li>
                  前往
                  <a
                    href="https://portal.qiniu.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300 hover:underline"
                  >
                    {' '}七牛云控制台
                  </a>
                  {' '}注册并创建存储空间（Bucket），绑定 CDN 访问域名
                </li>
                <li>复制 Access Key、Secret Key、Bucket 名称与 CDN 域名</li>
                <li>
                  编辑项目中的
                  <code className="text-cyan-300/90">backend/.env</code>
                  {' '}（可参考
                  <code className="text-cyan-300/90">backend/.env.example</code>）
                </li>
                <li>填入以下变量后重启后端服务</li>
              </ol>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-xs text-white/70 space-y-1">
            <p>QINIU_ACCESS_KEY=你的 Access Key</p>
            <p>QINIU_SECRET_KEY=你的 Secret Key</p>
            <p>QINIU_BUCKET=存储桶名称</p>
            <p>QINIU_DOMAIN=https://你的 CDN 域名</p>
            <p className="text-white/40">
              QINIU_REGION=z0 <span className="font-sans">（可选，默认华东）</span>
            </p>
          </div>
        </section>

        {/* API Base URL */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-white mb-1">API Base URL</h3>
          <p className="text-sm text-white/50 mb-4">
            Agnes AI 接口地址，默认为
            <code className="text-cyan-300/90"> {defaultBaseUrl}</code>
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={baseUrlForm}
              onChange={(e) => setBaseUrlForm(e.target.value)}
              type="url"
              className="input-field flex-1"
              placeholder="https://apihub.agnes-ai.com"
            />
            <div className="flex gap-2 flex-shrink-0">
              <button className="btn-secondary" onClick={resetBaseUrl}>
                恢复默认
              </button>
              <button className="btn-primary" disabled={savingBaseUrl} onClick={handleSaveBaseUrl}>
                {savingBaseUrl ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </section>

        {/* 添加 Key */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-white mb-1">添加 API Key</h3>
          <p className="text-sm text-white/50 mb-4">
            请先在
            <a
              href="https://platform.agnes-ai.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-300 hover:underline"
            >
              {' '}Agnes AI 平台
            </a>
            {' '}注册账号并创建 API Key，然后将 Key 粘贴到下方输入框。
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                type="text"
                className="input-field"
                placeholder="例如：主账号、备用账号"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5">API Key</label>
              <input
                value={form.api_key}
                onChange={(e) => setForm((prev) => ({ ...prev, api_key: e.target.value }))}
                type="password"
                className="input-field"
                placeholder="粘贴你的 Agnes AI API Key"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input
                checked={form.activate}
                onChange={(e) => setForm((prev) => ({ ...prev, activate: e.target.checked }))}
                type="checkbox"
                className="rounded border-white/20 bg-white/10 text-fuchsia-500 focus:ring-fuchsia-400/50"
              />
              添加后立即启用
            </label>
            <button className="btn-primary" disabled={saving} onClick={handleCreate}>
              {saving ? '添加中…' : '添加 Key'}
            </button>
          </div>
        </section>

        {/* Key 列表 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white">已配置的 Key</h3>
            <span className="text-xs text-white/40">{keys.length} 个</span>
          </div>

          {loading && <div className="text-center py-12 text-white/40">加载中…</div>}

          {!loading && keys.length === 0 && (
            <div className="text-center py-12 text-white/40">暂无 API Key，请先添加</div>
          )}

          {!loading && keys.length > 0 && (
            <div className="space-y-3">
              {keys.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 transition-all duration-200 ${
                    item.is_active
                      ? 'border-emerald-400/40 bg-emerald-400/10'
                      : 'border-white/10 bg-white/[0.04]'
                  }`}
                >
                  {editingId === item.id ? (
                    <div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="block text-xs text-white/50 mb-1">名称</label>
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                            type="text"
                            className="input-field"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 mb-1">
                            新 API Key（留空则不修改）
                          </label>
                          <input
                            value={editForm.api_key}
                            onChange={(e) =>
                              setEditForm((prev) => ({ ...prev, api_key: e.target.value }))
                            }
                            type="password"
                            className="input-field"
                            placeholder="留空保持原 Key 不变"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-3">
                        <button className="btn-ghost" onClick={cancelEdit}>
                          取消
                        </button>
                        <button className="btn-primary" onClick={() => handleSaveEdit(item.id)}>
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white">{item.name}</span>
                          {item.is_active && <span className="badge-completed">使用中</span>}
                        </div>
                        {item.key_masked && (
                          <p className="text-sm text-white/50 font-mono mt-1">{item.key_masked}</p>
                        )}
                        {item.created_at && (
                          <p className="text-xs text-white/30 mt-2">创建于 {item.created_at}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!item.is_active && (
                          <button
                            className="btn-secondary text-sm py-2 px-4"
                            onClick={() => handleActivate(item.id)}
                          >
                            启用
                          </button>
                        )}
                        <button className="btn-ghost text-sm" onClick={() => startEdit(item)}>
                          编辑
                        </button>
                        <button
                          className="btn-ghost text-sm text-rose-300 hover:text-rose-200"
                          onClick={() => handleDelete(item)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}