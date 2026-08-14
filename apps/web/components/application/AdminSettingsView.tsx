'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  settingsApi,
  type SettingView,
  type SettingHistoryEntry,
} from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'
import AgreementDocumentsEditor, { normalizeDocumentsJson } from './AgreementDocumentsEditor'

// ---------------------------------------------------------------------------
// Tab 定义与配置项映射
// ---------------------------------------------------------------------------

/** 登录条款相关配置 key（从「通用设置」中独立出来，形成单独的「登录条款」Tab）。 */
const AGREEMENT_KEYS = [
  'general.loginAgreementEnabled',
  'general.loginAgreementMode',
  'general.loginAgreementUpdatedAt',
  'general.loginAgreementDocuments',
] as const

const AGREEMENT_DOCUMENTS_KEY = 'general.loginAgreementDocuments'

type SettingsTabKey =
  | 'general'
  | 'agreement'
  | 'billing'
  | 'auth'
  | 'queue'
  | 'storage'
  | 'payment'
  | 'email'
  | 'log'
  | 'other'

interface SettingsTabDef {
  key: SettingsTabKey
  label: string
  description: string
  /** 该 Tab 覆盖的 settings group；other 为动态兜底。 */
  groups: string[]
  /** 仅包含这些 key（优先于 groups 过滤）。 */
  onlyKeys?: readonly string[]
  /** 从该 Tab 排除的 key。 */
  excludeKeys?: readonly string[]
}

const SETTINGS_TABS: SettingsTabDef[] = [
  {
    key: 'general',
    label: '通用设置',
    description: '站点名称、访问地址与客服入口等基础信息。',
    groups: ['general'],
    excludeKeys: AGREEMENT_KEYS,
  },
  {
    key: 'agreement',
    label: '登录条款',
    description: '控制登录和注册时是否要求用户阅读并同意服务条款、隐私政策及其他 Markdown 文档。',
    groups: ['general'],
    onlyKeys: AGREEMENT_KEYS,
  },
  {
    key: 'billing',
    label: '基础业务',
    description: '新用户注册赠金等计费基础策略。',
    groups: ['billing'],
  },
  {
    key: 'auth',
    label: '认证与安全',
    description: '登录注册的人机验证，以及限流、SSRF 防护等安全策略。',
    groups: ['auth', 'security'],
  },
  {
    key: 'queue',
    label: '生成任务',
    description: '生成任务的并发、重试与轮询策略。部分配置需要重启 Worker 进程后生效。',
    groups: ['queue'],
  },
  {
    key: 'storage',
    label: '存储配置',
    description: '生成结果的对象存储与媒体下载安全策略。',
    groups: ['storage'],
  },
  {
    key: 'payment',
    label: '支付设置',
    description: '充值渠道、兑换汇率与商户凭证。接入真实渠道需要商户账号。',
    groups: ['payment'],
  },
  {
    key: 'email',
    label: '邮件设置',
    description: 'SMTP 发信服务与邮件链接地址。',
    groups: ['email'],
  },
  {
    key: 'log',
    label: '日志与可观测性',
    description: '日志级别、格式与敏感内容开关。',
    groups: ['log'],
  },
]

/** 兜底 Tab：注册表新增 group 但未映射到上面任何 Tab 时，避免配置项被静默隐藏。 */
const OTHER_TAB: SettingsTabDef = {
  key: 'other',
  label: '其他',
  description: '未分类的配置项。',
  groups: [],
}

const TAB_KEYS: readonly string[] = [...SETTINGS_TABS.map((t) => t.key), OTHER_TAB.key]

function isTabKey(value: string | null | undefined): value is SettingsTabKey {
  return typeof value === 'string' && TAB_KEYS.includes(value)
}

function itemsForTab(tab: SettingsTabDef, settings: SettingView[]): SettingView[] {
  if (tab.key === 'other') {
    const covered = new Set(SETTINGS_TABS.flatMap((t) => t.groups))
    return settings.filter((s) => !covered.has(s.group))
  }
  return settings.filter((s) => {
    if (!tab.groups.includes(s.group)) return false
    if (tab.onlyKeys) return tab.onlyKeys.includes(s.key)
    if (tab.excludeKeys?.includes(s.key)) return false
    return true
  })
}

/** 多 group 的 Tab（如「认证与安全」）在面板头部展示的分组元信息。 */
const GROUP_PANEL_META: Record<string, { title: string; description?: string; danger?: boolean }> = {
  auth: { title: '登录认证', description: '登录 / 注册环节的人机验证。' },
  security: {
    title: '安全防护',
    description: '限流与 SSRF 防护策略。降低安全边界属于高风险操作。',
    danger: true,
  },
}

const AWS_STORAGE_KEYS = new Set([
  'storage.awsRegion',
  'storage.awsS3Bucket',
  'storage.awsS3Prefix',
  'storage.awsS3PublicBaseUrl',
  'storage.awsS3EndpointUrl',
  'storage.awsAccessKeyId',
  'storage.awsSecretAccessKey',
  'storage.awsSessionToken',
])
const QINIU_STORAGE_KEYS = new Set([
  'storage.qiniuAccessKey',
  'storage.qiniuSecretKey',
  'storage.qiniuBucket',
  'storage.qiniuDomain',
  'storage.qiniuRegion',
])

function enumLabel(value: string): string {
  switch (value) {
    case 'aws_s3':
      return 'AWS S3'
    case 'qiniu':
      return '七牛云'
    case 'none':
      return '不使用对象存储'
    case 'sandbox':
      return '沙箱演示'
    case 'alipay':
      return '支付宝'
    case 'wechat':
      return '微信支付'
    case 'modal':
      return '弹窗'
    case 'checkbox':
      return '复选框'
    case 'text':
      return 'text（纯文本）'
    case 'json':
      return 'JSON'
    case 'debug':
      return 'Debug'
    case 'info':
      return 'Info'
    case 'warn':
      return 'Warning'
    case 'error':
      return 'Error'
    case 'fatal':
      return 'Critical'
    default:
      return value
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// 基础 UI 组件
// ---------------------------------------------------------------------------

type BadgeTone = 'green' | 'amber' | 'blue' | 'red' | 'gray'

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  amber: 'bg-amber-50 text-amber-600 border-amber-100',
  blue: 'bg-blue-50 text-blue-600 border-blue-100',
  red: 'bg-red-50 text-red-600 border-red-100',
  gray: 'bg-gray-50 text-gray-500 border-gray-200',
}

function MetaBadge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${BADGE_TONE_CLASS[tone]}`}>
      {children}
    </span>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${
        checked ? 'bg-[#7C3AED]' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

/**
 * 保存按钮统一状态：未修改「无需保存」（禁用）→ 有修改「保存修改」→
 * 保存中「保存中…」→ 保存成功短暂显示「已保存」。
 */
function SaveButton({
  dirty,
  saving,
  saved,
  onClick,
}: {
  dirty: boolean
  saving: boolean
  saved: boolean
  onClick: () => void
}) {
  const label = saving ? '保存中…' : saved ? '已保存' : dirty ? '保存修改' : '无需保存'
  return (
    <button
      type="button"
      className="btn-primary text-sm"
      disabled={saving || !dirty}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 单个配置项行
// ---------------------------------------------------------------------------

interface SettingRowProps {
  setting: SettingView
  draft: string
  dirty: boolean
  saving: boolean
  saved: boolean
  showKeys: boolean
  danger: boolean
  onDraftChange: (value: string) => void
  onSave: () => void
  onClearSecret: () => void
  onShowHistory: () => void
}

function SettingRow({
  setting,
  draft,
  dirty,
  saving,
  saved,
  showKeys,
  danger,
  onDraftChange,
  onSave,
  onClearSecret,
  onShowHistory,
}: SettingRowProps) {
  const control = (() => {
    if (setting.valueType === 'boolean') {
      const checked = draft === 'true'
      return (
        <div className="flex min-h-[44px] items-center justify-between rounded-xl border border-gray-200 bg-white px-4">
          <span className="text-sm text-gray-600">{checked ? '已启用' : '已禁用'}</span>
          <ToggleSwitch checked={checked} onChange={(next) => onDraftChange(next ? 'true' : 'false')} ariaLabel={setting.label} />
        </div>
      )
    }
    if (setting.valueType === 'enum' && setting.options) {
      return (
        <select
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className="input-field w-full"
          aria-label={setting.label}
        >
          {setting.options.map((opt) => (
            <option key={opt} value={opt}>
              {enumLabel(opt)}
            </option>
          ))}
        </select>
      )
    }
    return (
      <input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        type={setting.valueType === 'number' ? 'number' : setting.isSecret ? 'password' : 'text'}
        className="input-field w-full"
        aria-label={setting.label}
        placeholder={setting.isSecret && setting.configured ? '••••••（留空保持不变）' : ''}
        {...(setting.valueType === 'number' && setting.min !== undefined ? { min: setting.min } : {})}
        {...(setting.valueType === 'number' && setting.max !== undefined ? { max: setting.max } : {})}
      />
    )
  })()

  return (
    <div className="flex flex-col gap-3 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{setting.label}</span>
          {setting.persisted && <MetaBadge tone="gray">已覆盖默认值</MetaBadge>}
          {setting.isSecret &&
            (setting.configured ? (
              <MetaBadge tone="green">已配置</MetaBadge>
            ) : (
              <MetaBadge tone="amber">未配置</MetaBadge>
            ))}
          {setting.restartRequired && <MetaBadge tone="blue">需重启生效</MetaBadge>}
          {setting.permission === 'settings.security_write' && <MetaBadge tone="red">需超管权限</MetaBadge>}
        </div>
        {setting.description && <p className="mt-1 text-xs leading-relaxed text-gray-500">{setting.description}</p>}
        {setting.isSecret && (
          <p className="mt-1 text-[11px] text-amber-600">
            {setting.configured ? '已加密存储：留空保持不变，输入新值覆盖' : '敏感字段，AES-GCM 加密存储'}
          </p>
        )}
        {danger && (
          <p className="mt-1 text-[11px] text-red-600">⚠ 降低安全边界可能引入 SSRF / 内网访问风险</p>
        )}
        {showKeys && (
          <code className="mt-1.5 inline-block rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
            {setting.key}
          </code>
        )}
      </div>

      <div className="w-full flex-shrink-0 space-y-2 lg:w-80">
        {control}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {setting.isSecret && setting.configured && (
            <button
              type="button"
              className="btn-secondary text-sm text-red-600"
              disabled={saving}
              onClick={onClearSecret}
              title="清除 Secret"
            >
              清除
            </button>
          )}
          <button type="button" className="btn-secondary text-sm" onClick={onShowHistory} title="查看该配置的变更历史">
            查看历史
          </button>
          <SaveButton dirty={dirty} saving={saving} saved={saved} onClick={onSave} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主视图
// ---------------------------------------------------------------------------

function AdminSettingsInner() {
  const { alert, confirm } = useDialog()
  const { user } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [settings, setSettings] = useState<SettingView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({})
  const [historyFor, setHistoryFor] = useState<{ key: string; label: string } | null>(null)
  const [history, setHistory] = useState<SettingHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showKeys, setShowKeys] = useState(false)

  const urlTab = searchParams?.get('tab') ?? null
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(() => (isTabKey(urlTab) ? urlTab : 'general'))

  const scrollRef = useRef<HTMLDivElement>(null)
  const tabButtonRefs = useRef<Map<SettingsTabKey, HTMLButtonElement>>(new Map())
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const timers = flashTimers.current
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer)
    }
  }, [])

  /** 保存成功后短暂显示「已保存」状态。 */
  const flashSaved = useCallback((id: string) => {
    setJustSaved((p) => ({ ...p, [id]: true }))
    clearTimeout(flashTimers.current[id])
    flashTimers.current[id] = setTimeout(() => {
      setJustSaved((p) => ({ ...p, [id]: false }))
    }, 2000)
  }, [])

  // ---- 加载 ----

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const items = await settingsApi.list()
      setSettings(items)
      const d: Record<string, string> = {}
      for (const s of items) {
        if (s.key === AGREEMENT_DOCUMENTS_KEY) {
          // 规范化 JSON，保证未修改时不产生脏标记
          d[s.key] = normalizeDocumentsJson(s.value)
        } else {
          // Secret 已配置时，draft 留空（用户需要重新输入完整值才能修改）
          d[s.key] = s.isSecret && s.configured ? '' : s.value
        }
      }
      setDrafts(d)
    } catch (e) {
      setSettings([])
      setLoadFailed(true)
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => {
    void load()
  }, [load])

  // ---- Tab：URL 同步 ----

  const replaceTabUrl = useCallback(
    (key: SettingsTabKey) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (params.get('tab') === key) return
      params.set('tab', key)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, pathname],
  )

  const selectTab = useCallback(
    (key: SettingsTabKey) => {
      setActiveTab(key)
      replaceTabUrl(key)
      scrollRef.current?.scrollTo({ top: 0 })
    },
    [replaceTabUrl],
  )

  // URL → state：外部导航 / 前进后退时恢复当前 Tab
  useEffect(() => {
    if (urlTab === null) return
    if (isTabKey(urlTab)) {
      setActiveTab((cur) => (cur === urlTab ? cur : urlTab))
    }
  }, [urlTab])

  // 无效 tab 参数：回退到「通用设置」并清理 URL
  useEffect(() => {
    if (urlTab !== null && !isTabKey(urlTab)) {
      setActiveTab('general')
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('tab', 'general')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
    // 仅在挂载时校验一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Tab：可见性与兜底 ----

  const visibleTabs = useMemo(() => {
    if (loading || settings.length === 0) return []
    const tabs = SETTINGS_TABS.filter((t) => itemsForTab(t, settings).length > 0)
    if (itemsForTab(OTHER_TAB, settings).length > 0) tabs.push(OTHER_TAB)
    return tabs
  }, [loading, settings])

  // 当前 Tab 无配置项（或加载后不存在）时回退
  useEffect(() => {
    if (visibleTabs.length === 0) return
    if (visibleTabs.some((t) => t.key === activeTab)) return
    const fallback = visibleTabs.some((t) => t.key === 'general') ? 'general' : visibleTabs[0].key
    setActiveTab(fallback)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (params.get('tab') !== fallback) {
      params.set('tab', fallback)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }, [visibleTabs, activeTab, searchParams, router, pathname])

  const activeTabDef = visibleTabs.find((t) => t.key === activeTab) ?? null

  const handleTabKeydown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, key: SettingsTabKey) => {
      const order = visibleTabs.map((t) => t.key)
      if (order.length === 0) return
      const index = order.indexOf(key)
      let nextKey: SettingsTabKey | undefined
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextKey = order[(index + 1) % order.length]
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextKey = order[(index - 1 + order.length) % order.length]
      } else if (event.key === 'Home') {
        nextKey = order[0]
      } else if (event.key === 'End') {
        nextKey = order[order.length - 1]
      } else {
        return
      }
      event.preventDefault()
      const target = nextKey
      if (!target) return
      selectTab(target)
      window.requestAnimationFrame(() => tabButtonRefs.current.get(target)?.focus())
    },
    [visibleTabs, selectTab],
  )

  // ---- 脏标记 ----

  const isDirty = useCallback(
    (setting: SettingView): boolean => {
      const draft = (drafts[setting.key] ?? '').trim()
      // Secret 留空 = 保持不变，不算修改
      if (setting.isSecret && draft === '') return false
      return draft !== setting.value
    },
    [drafts],
  )

  const hasDirtyKeys = useCallback(
    (keys: string[]): boolean => settings.filter((s) => keys.includes(s.key)).some((s) => isDirty(s)),
    [settings, isDirty],
  )

  // ---- 保存 ----

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
        flashSaved(key)
        if (setting.restartRequired) {
          await alert({ title: '已保存', message: '配置已更新，但需要重启服务才能生效' })
        }
      } catch (e) {
        await alert({ title: '保存失败', message: formatErrorMessage(e) })
      } finally {
        setSaving((p) => ({ ...p, [key]: false }))
      }
    },
    [drafts, settings, alert, flashSaved],
  )

  const handleBatchSave = useCallback(
    async (id: string, keys: string[]) => {
      const targets = settings.filter((s) => keys.includes(s.key))
      const dirtyItems: Array<{ key: string; value: string }> = []
      for (const s of targets) {
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
      const savingId = `batch:${id}`
      setSaving((p) => ({ ...p, [savingId]: true }))
      try {
        const updated = await settingsApi.batchUpdate(dirtyItems)
        setSettings(updated)
        const d: Record<string, string> = {}
        for (const s of updated) {
          if (s.key === AGREEMENT_DOCUMENTS_KEY) {
            d[s.key] = normalizeDocumentsJson(s.value)
          } else {
            d[s.key] = s.isSecret && s.configured ? '' : s.value
          }
        }
        setDrafts((prev) => ({ ...prev, ...d }))
        flashSaved(savingId)
      } catch (e) {
        await alert({ title: '批量保存失败', message: formatErrorMessage(e) })
      } finally {
        setSaving((p) => ({ ...p, [savingId]: false }))
      }
    },
    [drafts, settings, alert, flashSaved],
  )

  const handleClearSecret = useCallback(
    async (key: string, label: string) => {
      const ok = await confirm({
        title: '清除 Secret',
        message: `确定清除「${label}」的密钥值吗？此操作不可撤销，可能影响相关功能。`,
      })
      if (!ok) return
      setSaving((p) => ({ ...p, [key]: true }))
      try {
        await settingsApi.clearSecret(key)
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

  const loadHistory = useCallback(
    async (key: string, label: string) => {
      setHistoryLoading(true)
      try {
        const entries = await settingsApi.history(key)
        setHistory(entries)
        setHistoryFor({ key, label })
      } catch (e) {
        await alert({ title: '历史加载失败', message: formatErrorMessage(e) })
      } finally {
        setHistoryLoading(false)
      }
    },
    [alert],
  )

  // ---- 存储状态 ----

  const storageProvider =
    drafts['storage.provider'] || settings.find((s) => s.key === 'storage.provider')?.value || 'aws_s3'
  const storageConfigured = (() => {
    if (storageProvider === 'none') return true
    if (storageProvider === 'aws_s3') {
      const accessKeyConfigured = Boolean(
        settings.find((s) => s.key === 'storage.awsAccessKeyId')?.configured || drafts['storage.awsAccessKeyId']?.trim(),
      )
      const secretKeyConfigured = Boolean(
        settings.find((s) => s.key === 'storage.awsSecretAccessKey')?.configured || drafts['storage.awsSecretAccessKey']?.trim(),
      )
      return Boolean(
        drafts['storage.awsS3Bucket']?.trim() &&
          (accessKeyConfigured === secretKeyConfigured),
      )
    }
    return Boolean(
      (settings.find((s) => s.key === 'storage.qiniuAccessKey')?.configured || drafts['storage.qiniuAccessKey']?.trim()) &&
        (settings.find((s) => s.key === 'storage.qiniuSecretKey')?.configured || drafts['storage.qiniuSecretKey']?.trim()) &&
        drafts['storage.qiniuBucket']?.trim() &&
        drafts['storage.qiniuDomain']?.trim(),
    )
  })()

  const handleStorageTest = useCallback(async () => {
    setSaving((p) => ({ ...p, 'storage:test': true }))
    try {
      const result = await settingsApi.testStorage()
      await alert({
        title: '存储测试完成',
        message: `Provider：${result.provider}\nBucket/空间：${result.bucket}\n对象存在：${result.exists ? '是' : '否'}\nURL 可访问：${result.publicUrlAccessible ? '是' : '否'}`,
      })
    } catch (e) {
      await alert({ title: '存储测试失败', message: formatErrorMessage(e) })
    } finally {
      setSaving((p) => ({ ...p, 'storage:test': false }))
    }
  }, [alert])

  // ---- 渲染 ----

  /** 非 ADMIN 用户不允许进入（后端已拦截，前端仅提示）。 */
  if (user && user.role !== 'ADMIN') {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">仅管理员可访问系统配置</p>
      </div>
    )
  }

  const renderRows = (items: SettingView[], options: { danger: boolean }) =>
    items.map((setting) => (
      <SettingRow
        key={setting.key}
        setting={setting}
        draft={drafts[setting.key] ?? ''}
        dirty={isDirty(setting)}
        saving={Boolean(saving[setting.key])}
        saved={Boolean(justSaved[setting.key])}
        showKeys={showKeys}
        danger={options.danger || setting.group === 'security'}
        onDraftChange={(value) => setDrafts((p) => ({ ...p, [setting.key]: value }))}
        onSave={() => void handleSave(setting.key)}
        onClearSecret={() => void handleClearSecret(setting.key, setting.label)}
        onShowHistory={() => void loadHistory(setting.key, setting.label)}
      />
    ))

  /** 存储 Tab：按当前 provider 过滤 AWS / 七牛字段。 */
  const filterStorageItems = (items: SettingView[]) =>
    items.filter((setting) => {
      if (setting.key === 'storage.provider') return true
      if (AWS_STORAGE_KEYS.has(setting.key)) return storageProvider === 'aws_s3'
      if (QINIU_STORAGE_KEYS.has(setting.key)) return storageProvider === 'qiniu'
      return true
    })

  const renderTabContent = (tab: SettingsTabDef) => {
    const items = itemsForTab(tab, settings)
    const tabKeys = items.map((s) => s.key)
    const tabDirty = hasDirtyKeys(tabKeys)
    const batchId = `batch:${tab.key}`
    const isStorageTab = tab.key === 'storage'
    const visibleItems = isStorageTab ? filterStorageItems(items) : items

    // 「登录条款」使用定制页面
    if (tab.key === 'agreement') {
      return renderAgreementTab(items, tabDirty, batchId)
    }

    // 按 group 分组成面板（同 group 聚合到一个面板，避免被注册表顺序打散）
    const panels: Array<{ group: string; items: SettingView[] }> = []
    for (const item of visibleItems) {
      const existing = panels.find((p) => p.group === item.group)
      if (existing) existing.items.push(item)
      else panels.push({ group: item.group, items: [item] })
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-gray-500">{tab.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            {isStorageTab && (
              <>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    storageConfigured
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                      : 'border-amber-100 bg-amber-50 text-amber-600'
                  }`}
                >
                  {storageProvider === 'none' ? '未启用对象存储' : storageConfigured ? '对象存储已配置' : '请配置对象存储'}
                </span>
                {storageProvider !== 'none' && (
                  <button
                    type="button"
                    className="btn-secondary text-sm disabled:opacity-50"
                    disabled={saving['storage:test'] || !storageConfigured}
                    onClick={() => void handleStorageTest()}
                  >
                    {saving['storage:test'] ? '测试中…' : '测试存储'}
                  </button>
                )}
              </>
            )}
            <SaveButton
              dirty={tabDirty}
              saving={Boolean(saving[batchId])}
              saved={Boolean(justSaved[batchId])}
              onClick={() => void handleBatchSave(tab.key, tabKeys)}
            />
          </div>
        </div>

        {panels.map((panel) => {
          const meta = GROUP_PANEL_META[panel.group]
          const showPanelHeader = panels.length > 1 || isStorageTab || meta?.danger
          const danger = Boolean(meta?.danger)
          return (
            <section
              key={panel.group}
              className={`overflow-hidden rounded-2xl border bg-white shadow-card ${
                danger ? 'border-red-200' : 'border-gray-200'
              }`}
            >
              {showPanelHeader && (
                <header className="border-b border-gray-100 px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">{meta?.title ?? tab.label}</h3>
                    {danger && <MetaBadge tone="red">高风险</MetaBadge>}
                  </div>
                  {(() => {
                    const panelDescription = meta?.description ?? (panels.length > 1 ? tab.description : undefined)
                    return panelDescription ? (
                      <p className="mt-0.5 text-xs text-gray-500">{panelDescription}</p>
                    ) : null
                  })()}
                </header>
              )}
              {danger && (
                <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700 sm:mx-6">
                  ⚠ 高风险配置：降低安全边界可能引入 SSRF / 内网访问风险，修改前请确认影响范围。此类配置需要更高的管理员权限。
                </div>
              )}
              <div className="divide-y divide-gray-100">{renderRows(panel.items, { danger })}</div>
            </section>
          )
        })}
      </div>
    )
  }

  const renderAgreementTab = (items: SettingView[], tabDirty: boolean, batchId: string) => {
    const agreementKeys = items.map((s) => s.key)
    const enabled = drafts['general.loginAgreementEnabled'] === 'true'
    const mode = drafts['general.loginAgreementMode'] ?? 'modal'
    const updatedAt = drafts['general.loginAgreementUpdatedAt'] ?? ''
    const useDateInput = updatedAt === '' || DATE_PATTERN.test(updatedAt)

    const historyLink = (key: string, label: string) => (
      <button
        type="button"
        className="text-xs text-gray-400 underline-offset-2 transition-colors hover:text-gray-600 hover:underline"
        onClick={() => void loadHistory(key, label)}
      >
        查看历史
      </button>
    )

    const findByKey = (key: string) => items.find((s) => s.key === key)

    return (
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card">
        <header className="flex flex-col gap-4 border-b border-gray-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">登录条款</h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">
              控制登录和注册时是否要求用户阅读并同意服务条款、隐私政策及其他 Markdown 文档。
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">启用登录条款</p>
              <p className={`text-xs ${enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                {enabled ? '已启用' : '未启用'}
              </p>
            </div>
            <ToggleSwitch
              checked={enabled}
              onChange={(next) =>
                setDrafts((p) => ({ ...p, ['general.loginAgreementEnabled']: next ? 'true' : 'false' }))
              }
              ariaLabel="启用登录条款"
            />
          </div>
        </header>

        <div className="space-y-8 p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900">条款展示形式</span>
                {findByKey('general.loginAgreementMode') && historyLink('general.loginAgreementMode', '条款展示形式')}
              </div>
              <div className="mt-2 grid max-w-sm grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
                {(['modal', 'checkbox'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      mode === m ? 'bg-white text-[#6D28D9] shadow-sm' : 'text-gray-500 hover:text-gray-800'
                    }`}
                    onClick={() => setDrafts((p) => ({ ...p, ['general.loginAgreementMode']: m }))}
                  >
                    {m === 'modal' ? '弹窗' : '复选框'}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                {mode === 'checkbox'
                  ? '复选框显示在登录按钮下方，未勾选时所有登录 / 注册入口不可用。'
                  : '登录页将弹出条款窗口，用户确认后才能登录或注册。'}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900">条款更新日期</span>
                {findByKey('general.loginAgreementUpdatedAt') && historyLink('general.loginAgreementUpdatedAt', '条款更新日期')}
              </div>
              {useDateInput ? (
                <input
                  type="date"
                  className="input-field mt-2 w-full"
                  value={updatedAt}
                  onChange={(e) => setDrafts((p) => ({ ...p, ['general.loginAgreementUpdatedAt']: e.target.value }))}
                  aria-label="条款更新日期"
                />
              ) : (
                <input
                  type="text"
                  className="input-field mt-2 w-full"
                  value={updatedAt}
                  placeholder="YYYY-MM-DD"
                  onChange={(e) => setDrafts((p) => ({ ...p, ['general.loginAgreementUpdatedAt']: e.target.value }))}
                  aria-label="条款更新日期"
                />
              )}
              <p className="mt-2 text-xs leading-relaxed text-gray-500">日期或文档内容变化后，用户需要重新同意。</p>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <h4 className="text-sm font-semibold text-gray-900">协议文档</h4>
                  {findByKey(AGREEMENT_DOCUMENTS_KEY) && historyLink(AGREEMENT_DOCUMENTS_KEY, '协议文档')}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  文档名称可自定义，内容按 Markdown 保存。可参考：服务条款、隐私政策、使用政策。
                </p>
              </div>
            </div>
            <div className="mt-4">
              <AgreementDocumentsEditor
                value={drafts[AGREEMENT_DOCUMENTS_KEY] ?? '[]'}
                onChange={(value) => setDrafts((p) => ({ ...p, [AGREEMENT_DOCUMENTS_KEY]: value }))}
              />
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6">
          <p className="text-xs text-gray-400">保存后立即生效；条款版本变化后，用户下次登录需重新确认。</p>
          <SaveButton
            dirty={tabDirty}
            saving={Boolean(saving[batchId])}
            saved={Boolean(justSaved[batchId])}
            onClick={() => void handleBatchSave('agreement', agreementKeys)}
          />
        </footer>
      </section>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-5 sm:px-8">
        <div>
          <h2 className="text-xl font-bold text-gray-900">系统配置</h2>
          <p className="mt-1 text-sm text-gray-500">动态配置保存后立即生效；未修改的项使用环境变量或默认值。</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          <label
            className="hidden cursor-pointer select-none items-center gap-1.5 text-xs text-gray-400 sm:flex"
            title="调试用：在每个配置项下方显示内部配置 key"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-gray-300 accent-[#7C3AED]"
              checked={showKeys}
              onChange={(e) => setShowKeys(e.target.checked)}
            />
            显示配置 key
          </label>
          <button type="button" className="btn-secondary text-sm" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#FAFAFB]">
        <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-8">
          {loading && <div className="py-24 text-center text-gray-400">加载中…</div>}

          {!loading && loadFailed && settings.length === 0 && (
            <div className="py-24 text-center">
              <p className="text-gray-500">配置加载失败</p>
              <button type="button" className="btn-secondary mt-4 text-sm" onClick={() => void load()}>
                重试
              </button>
            </div>
          )}

          {!loading && !loadFailed && settings.length === 0 && (
            <div className="py-24 text-center text-gray-400">暂无配置项</div>
          )}

          {!loading && visibleTabs.length > 0 && (
            <>
              {/* 顶部 Tab：sticky 固定在设置内容顶部，支持横向滚动与键盘切换 */}
              <div className="sticky top-0 z-20 -mx-1 bg-[#FAFAFB]/95 px-1 pb-3 pt-4 backdrop-blur">
                <div className="rounded-2xl border border-gray-200 bg-white/95 p-1.5 shadow-sm">
                  <nav role="tablist" aria-label="系统配置分类" className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex min-w-max items-center gap-1">
                      {visibleTabs.map((tab) => {
                        const active = tab.key === activeTab
                        const dirty = hasDirtyKeys(itemsForTab(tab, settings).map((s) => s.key))
                        return (
                          <button
                            key={tab.key}
                            ref={(el) => {
                              if (el) tabButtonRefs.current.set(tab.key, el)
                              else tabButtonRefs.current.delete(tab.key)
                            }}
                            id={`settings-tab-${tab.key}`}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            aria-controls={`settings-panel-${tab.key}`}
                            tabIndex={active ? 0 : -1}
                            onClick={() => selectTab(tab.key)}
                            onKeyDown={(e) => handleTabKeydown(e, tab.key)}
                            className={`relative flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-4 text-sm font-medium outline-none transition-colors duration-150 ${
                              active
                                ? 'bg-primary-50 text-primary-700'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                            } focus-visible:ring-2 focus-visible:ring-primary-500/40`}
                          >
                            {tab.label}
                            {dirty && (
                              <span
                                className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-400"
                                aria-hidden="true"
                                title="有未保存的修改"
                              />
                            )}
                            {active && (
                              <span
                                className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#06B6D4]"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </nav>
                </div>
              </div>

              {activeTabDef && (
                <div
                  role="tabpanel"
                  id={`settings-panel-${activeTabDef.key}`}
                  aria-labelledby={`settings-tab-${activeTabDef.key}`}
                >
                  {renderTabContent(activeTabDef)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 变更历史弹层 */}
      {historyFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setHistoryFor(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">变更历史：{historyFor.label}</h3>
                {showKeys && (
                  <code className="mt-1 inline-block font-mono text-[10px] text-gray-400">{historyFor.key}</code>
                )}
              </div>
              <button type="button" className="btn-secondary text-sm" onClick={() => setHistoryFor(null)}>
                关闭
              </button>
            </div>
            {historyLoading ? (
              <div className="py-8 text-center text-gray-400">加载中…</div>
            ) : history.length === 0 ? (
              <div className="py-8 text-center text-gray-400">暂无变更记录</div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-800">v{h.version}</span>
                      <span className="text-[10px] text-gray-400">{new Date(h.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {h.reason && <span>原因：{h.reason}</span>}
                      {h.updatedBy && <span> 操作者：{h.updatedBy}</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-gray-400">
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

/**
 * useSearchParams 需要 Suspense 边界（Next.js App Router 预渲染要求）。
 */
export default function AdminSettingsView() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="animate-pulse text-sm text-gray-400">加载中…</div>
        </div>
      }
    >
      <AdminSettingsInner />
    </Suspense>
  )
}
