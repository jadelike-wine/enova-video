'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Checkbox, Input, InputNumber, Modal, Result, Select, Skeleton, Spin, Switch, Tag } from 'antd'
import {
  settingsApi,
  isStepUpRequired,
  type SettingView,
  type SettingHistoryEntry,
} from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'
import { ContentLoading } from './admin/AdminUi'
import { normalizeDocumentsJson } from './AgreementDocumentsEditor'
import EmailSettingsPanel from './admin/EmailSettingsPanel'
import AgreementSettingsPanel from './admin-settings/AgreementSettingsPanel'
import AiTitleSettingsPanel from './admin-settings/AiTitleSettingsPanel'
import BackupSettingsPanel from './admin-settings/BackupSettingsPanel'
import FeaturesSettingsPanel from './admin-settings/FeaturesSettingsPanel'
import GatewaySettingsPanel from './admin-settings/GatewaySettingsPanel'
import GeneralSettingsPanel from './admin-settings/GeneralSettingsPanel'
import PaymentSettingsPanel from './admin-settings/PaymentSettingsPanel'
import SecuritySettingsPanel from './admin-settings/SecuritySettingsPanel'
import UserDefaultsSettingsPanel from './admin-settings/UserDefaultsSettingsPanel'
import {
  AGREEMENT_DOCUMENTS_KEY,
  SETTINGS_TABS,
  itemsForTab,
  isTabKey,
  type SettingsTabDef,
  type SettingsTabKey,
} from './admin-settings/settings-tabs'

/** 多 group 的 Tab（如「安全与认证」「网关服务」「功能开关」）在面板头部展示的分组元信息。 */
const GROUP_PANEL_META: Record<string, { title: string; description?: string; danger?: boolean }> = {
  auth: { title: '登录认证', description: '登录 / 注册环节的人机验证。' },
  security: {
    title: '安全防护',
    description: '限流与 SSRF 防护策略。降低安全边界属于高风险操作。',
    danger: true,
  },
  table: { title: '通用表格设置', description: '统一控制后台与用户侧表格组件的默认分页行为。' },
  customization: { title: '自定义页面设置', description: '首页内容、自定义菜单和功能开关。' },
  log: { title: '日志与可观测性', description: '日志级别、格式与敏感内容开关。' },
  queue: { title: '生成任务', description: '生成任务的并发、重试与轮询策略。' },
  storage: { title: '对象存储', description: '生成结果的对象存储与媒体下载安全策略。' },
  billing: { title: '用户默认值', description: '新用户注册赠金等用户默认策略。' },
  ai: { title: 'AI 标题生成', description: 'OpenAI 兼容标题模型、凭证与中英文提示词。' },
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

// ---------------------------------------------------------------------------
// 基础 UI 组件
// ---------------------------------------------------------------------------

type BadgeTone = 'green' | 'amber' | 'blue' | 'red' | 'gray'

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  amber: 'bg-amber-50 text-amber-600 border-amber-100',
  blue: 'bg-blue-50 text-blue-600 border-blue-100',
  red: 'bg-red-50 text-red-600 border-red-100',
  gray: 'bg-gray-50 text-gray-500 border-gray-100',
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
    <Switch
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  )
}

const SETTINGS_TAB_ICON_PATHS: Record<SettingsTabKey, string> = {
  general: 'M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5M9 21v-6h6v6',
  agreement: 'M6 3.5h9l3 3V21H6zM15 3.5V7h3M9 11h6M9 15h6',
  features: 'm12 3 1.8 5.3L19 10l-5.2 1.7L12 17l-1.8-5.3L5 10l5.2-1.7zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
  security: 'M12 3 19 6v5c0 4.7-3 8.2-7 10-4-1.8-7-5.3-7-10V6zM9 12l2 2 4-4',
  users: 'M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 4.5a4 4 0 0 1 0 7.8M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.4',
  ai: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4',
  gateway: 'M4 5h16v12H4zM8 21h8M12 17v4M8 9h8M8 12h5',
  payment: 'M3 6h18v12H3zM3 10h18M7 15h3',
  email: 'M3 5h18v14H3zM3 6l9 7 9-7',
  backup: 'M4 6h16v12H4zM8 6V4h8v2M8 10h8M8 14h5',
}

function SettingsTabIcon({ tabKey }: { tabKey: SettingsTabKey }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d={SETTINGS_TAB_ICON_PATHS[tabKey]} />
    </svg>
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
  const t = useTranslations('admin.settings')
  const label = saving ? t('saving') : saved ? t('saved') : dirty ? t('saveModified') : t('noSaveNeeded')
  return (
    <Button
      type="primary"
      size="small"
      loading={saving}
      disabled={!dirty}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// 单个配置项行 — 复刻 sub2api 两栏布局：左侧 label+description，右侧控件
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

/** 需要 Textarea 渲染的配置 key 集合。 */
const TEXTAREA_KEYS = new Set([
  'general.homeContent',
  'general.customMenuItems',
])

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
        <div className="flex min-h-[40px] items-center justify-between rounded-xl border border-gray-100 bg-white px-4">
          <span className="text-sm text-gray-600">{checked ? '已启用' : '已禁用'}</span>
          <ToggleSwitch checked={checked} onChange={(next) => onDraftChange(next ? 'true' : 'false')} ariaLabel={setting.label} />
        </div>
      )
    }
    if (setting.valueType === 'enum' && setting.options) {
      return (
        <Select
          value={draft}
          onChange={(val) => onDraftChange(val as string)}
          className="w-full"
          aria-label={setting.label}
          options={setting.options.map((opt) => ({ value: opt, label: enumLabel(opt) }))}
        />
      )
    }
    if (setting.valueType === 'number') {
      return (
        <InputNumber
          value={draft}
          onChange={(val) => onDraftChange(String(val ?? ''))}
          className="w-full"
          aria-label={setting.label}
          placeholder={setting.isSecret && setting.configured ? '••••••（留空保持不变）' : ''}
          min={setting.min !== undefined ? String(setting.min) : undefined}
          max={setting.max !== undefined ? String(setting.max) : undefined}
        />
      )
    }
    if (TEXTAREA_KEYS.has(setting.key)) {
      return (
        <Input.TextArea
          value={draft}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onDraftChange(e.target.value)}
          className="w-full"
          aria-label={setting.label}
          autoSize={{ minRows: 3, maxRows: 12 }}
        />
      )
    }
    return (
      <Input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        type={setting.isSecret ? 'password' : 'text'}
        className="w-full"
        aria-label={setting.label}
        placeholder={setting.isSecret && setting.configured ? '••••••（留空保持不变）' : ''}
      />
    )
  })()

  return (
    <div className="flex flex-col gap-2 px-5 py-4 sm:px-6 lg:flex-row lg:items-start lg:gap-8">
      {/* 左侧：label + description */}
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
        {setting.description && <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{setting.description}</p>}
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

      {/* 右侧：控件 + 操作按钮 */}
      <div className="w-full flex-shrink-0 space-y-2 lg:w-80">
        {control}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {setting.isSecret && setting.configured && (
            <Button
              size="small"
              danger
              disabled={saving}
              onClick={onClearSecret}
              title="清除 Secret"
            >
              清除
            </Button>
          )}
          <Button size="small" onClick={onShowHistory} title="查看该配置的变更历史">
            查看历史
          </Button>
          <SaveButton dirty={dirty} saving={saving} saved={saved} onClick={onSave} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主视图
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step-up 密码验证对话框
// ---------------------------------------------------------------------------

/**
 * 安全敏感配置（ssrf.*、security.rateLimit*）保存时弹出，
 * 要求管理员输入登录密码完成二次验证。
 *
 * 与 sub2api 的 TotpStepUpDialog 语义一致，但本项目 step-up 方式为 PASSWORD
 * （见 SensitiveActionService），不是 TOTP。
 */
function StepUpPasswordModal({
  visible,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  onConfirm: (password: string) => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  // 每次打开时清空密码
  useEffect(() => {
    if (visible) setPassword('')
  }, [visible])

  return (
    <Modal
      open={visible}
      title="安全验证"
      okText="确认"
      cancelText="取消"
      onOk={() => onConfirm(password)}
      onCancel={onCancel}
      destroyOnClose
      maskClosable={false}
    >
      <div className="space-y-3 py-2">
        <p className="text-sm text-gray-600">
          此操作涉及安全敏感配置，需要管理员密码二次验证。
        </p>
        <Input.Password
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入管理员密码"
          autoFocus
          onPressEnter={() => onConfirm(password)}
          aria-label="管理员密码"
        />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// 主视图
// ---------------------------------------------------------------------------

function AdminSettingsInner() {
  const t = useTranslations('admin.settings')
  const translateDynamic = (key: string) => t(key as never)
  const { alert, confirm } = useDialog()
  const { user } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [settings, setSettings] = useState<SettingView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({})
  const [historyFor, setHistoryFor] = useState<{ key: string; label: string } | null>(null)
  const [history, setHistory] = useState<SettingHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showKeys, setShowKeys] = useState(false)

  // Step-up 密码验证对话框状态：安全敏感配置（ssrf.*、security.rateLimit*）保存时
  // 后端返回 stepUpRequired=true，前端弹出管理员密码框，输入后带 header 重试。
  const [stepUpVisible, setStepUpVisible] = useState(false)
  const stepUpResolver = useRef<((password: string | null) => void) | null>(null)

  // 竞态防护：用于取消旧请求，避免组件卸载后 setState
  const loadRequestId = useRef(0)
  const isMounted = useRef(true)

  const urlTab = searchParams?.get('tab') ?? null
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(() => (isTabKey(urlTab) ? urlTab : 'general'))

  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const timers = flashTimers.current
    return () => {
      isMounted.current = false
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

  // ---- 加载（带竞态防护） ----

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setLoadFailed(false)
    setLoadError(null)
    try {
      const items = await settingsApi.list()
      // 竞态防护：如果已有更新的请求或组件已卸载，丢弃结果
      if (requestId !== loadRequestId.current || !isMounted.current) return
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
      if (requestId !== loadRequestId.current || !isMounted.current) return
      setSettings([])
      setLoadFailed(true)
      setLoadError(formatErrorMessage(e))
    } finally {
      if (requestId === loadRequestId.current && isMounted.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    isMounted.current = true
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
    // 所有 Tab 都保持可见（backup 作为预留 Tab，即使无配置项也展示空状态）
    return SETTINGS_TABS
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

  // ---- Tab 滚动容器 ref（用于自动滚动到当前 Tab） ----
  const tabsScrollRef = useRef<HTMLDivElement>(null)

  /** 平滑滚动到指定 Tab，确保它完全可见。 */
  const scrollToTab = useCallback(
    (tabKey: SettingsTabKey) => {
      const container = tabsScrollRef.current
      if (!container) return
      const button = container.querySelector<HTMLButtonElement>(`[data-settings-tab="${tabKey}"]`)
      if (!button) return
      const containerRect = container.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      // 计算目标 scrollLeft，使按钮居中显示（优先）或至少完全可见
      const buttonCenter = buttonRect.left + buttonRect.width / 2 - containerRect.left
      const targetScroll = container.scrollLeft + buttonCenter - containerRect.width / 2
      container.scrollTo({ left: targetScroll, behavior: 'smooth' })
    },
    [],
  )

  // 切换 Tab 时自动滚动
  useEffect(() => {
    scrollToTab(activeTab)
  }, [activeTab, scrollToTab])

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

  // ---- Step-up 密码验证 ----

  /**
   * 弹出 step-up 密码验证对话框，返回用户输入的密码或 null（取消）。
   *
   * 安全敏感配置（ssrf.*、security.rateLimit*）保存时后端要求二次验证，
   * 前端弹出管理员密码框，输入后带 x-step-up-password header 重试原始请求。
   * 与 sub2api 的 useStepUp().prompt() 语义一致。
   */
  const promptStepUpPassword = useCallback((): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      stepUpResolver.current = resolve
      setStepUpVisible(true)
    })
  }, [])

  const handleStepUpConfirm = useCallback((password: string) => {
    setStepUpVisible(false)
    stepUpResolver.current?.(password || null)
    stepUpResolver.current = null
  }, [])

  const handleStepUpCancel = useCallback(() => {
    setStepUpVisible(false)
    stepUpResolver.current?.(null)
    stepUpResolver.current = null
  }, [])

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
        let updated: SettingView
        try {
          updated = await settingsApi.update(key, value)
        } catch (e) {
          // 安全敏感配置（ssrf.*、security.rateLimit*）保存时后端返回 stepUpRequired，
          // 弹出管理员密码框，输入后带 x-step-up-password header 重试。
          if (!isStepUpRequired(e)) throw e
          const password = await promptStepUpPassword()
          if (!password) return // 用户取消
          updated = await settingsApi.update(key, value, undefined, password)
        }
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
    [drafts, settings, alert, flashSaved, promptStepUpPassword],
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
        let updated: SettingView[]
        try {
          updated = await settingsApi.batchUpdate(dirtyItems)
        } catch (e) {
          // 批量保存安全敏感配置时后端可能返回 stepUpRequired，弹出密码框重试。
          if (!isStepUpRequired(e)) throw e
          const password = await promptStepUpPassword()
          if (!password) return // 用户取消
          updated = await settingsApi.batchUpdate(dirtyItems, password)
        }
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
    [drafts, settings, alert, flashSaved, promptStepUpPassword],
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
        try {
          await settingsApi.clearSecret(key)
        } catch (e) {
          // 安全敏感配置的 Secret 清除可能触发 step-up，弹出密码框重试。
          if (!isStepUpRequired(e)) throw e
          const password = await promptStepUpPassword()
          if (!password) return // 用户取消
          await settingsApi.clearSecret(key, password)
        }
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
    [confirm, alert, promptStepUpPassword],
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
        <p className="text-gray-500">{t('adminOnly')}</p>
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
    const isGatewayTab = tab.key === 'gateway'
    const visibleItems = isGatewayTab ? filterStorageItems(items) : items

    // 「通用设置」使用结构化业务面板，复杂 JSON 仅在面板内编辑。
    if (tab.key === 'general') {
      return (
        <GeneralSettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('general', keys)}
          saving={Boolean(saving[batchId])}
          saved={Boolean(justSaved[batchId])}
        />
      )
    }

    if (tab.key === 'agreement') {
      return (
        <AgreementSettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('agreement', keys)}
          saving={Boolean(saving[batchId])}
          saved={Boolean(justSaved[batchId])}
          onShowHistory={(key, label) => void loadHistory(key, label)}
        />
      )
    }

    if (tab.key === 'features') {
      return (
        <FeaturesSettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('features', keys)}
          saving={Boolean(saving[batchId])}
          saved={Boolean(justSaved[batchId])}
        />
      )
    }

    if (tab.key === 'security') {
      return (
        <SecuritySettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('security', keys)}
          saving={Boolean(saving[batchId])}
          saved={Boolean(justSaved[batchId])}
        />
      )
    }

    if (tab.key === 'users') {
      return (
        <UserDefaultsSettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('users', keys)}
          saving={Boolean(saving[batchId])}
          saved={Boolean(justSaved[batchId])}
        />
      )
    }

    if (tab.key === 'gateway') {
      return (
        <GatewaySettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('gateway', keys)}
          saving={Boolean(saving[batchId]) || Boolean(saving['storage:test'])}
          saved={Boolean(justSaved[batchId])}
          onStorageTest={() => void handleStorageTest()}
        />
      )
    }

    if (tab.key === 'ai') {
      return <AiTitleSettingsPanel settings={items} drafts={drafts} onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))} onBatchSave={(keys) => void handleBatchSave('ai', keys)} saving={Boolean(saving[batchId])} saved={Boolean(justSaved[batchId])} />
    }

    if (tab.key === 'payment') {
      return (
        <PaymentSettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('payment', keys)}
          saving={Boolean(saving[batchId])}
          saved={Boolean(justSaved[batchId])}
        />
      )
    }

    // 「数据备份」Tab：只展示真实环境变量、脚本和文档入口
    if (tab.key === 'backup') {
      return <BackupSettingsPanel />
    }

    // 「邮件设置」使用专门的邮件设置面板
    if (tab.key === 'email') {
      return (
        <EmailSettingsPanel
          settings={items}
          drafts={drafts}
          onDraftChange={(key, value) => setDrafts((p) => ({ ...p, [key]: value }))}
          onBatchSave={(keys) => void handleBatchSave('email', keys)}
          saving={Boolean(saving[batchId])}
          saved={Boolean(justSaved[batchId])}
        />
      )
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
        {/* Tab 描述 + 批量保存按钮 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-gray-500">{translateDynamic(`tabDescriptions.${tab.key}`)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {isGatewayTab && storageProvider !== 'none' && (
              <>
                <Tag color={storageConfigured ? 'success' : 'warning'}>
                  {storageConfigured ? '对象存储已配置' : '请配置对象存储'}
                </Tag>
                <Button
                  size="small"
                  loading={saving['storage:test']}
                  disabled={!storageConfigured}
                  onClick={() => void handleStorageTest()}
                >
                  测试存储
                </Button>
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

        {/* 设置面板 — 复刻 sub2api card 样式 */}
        {panels.map((panel) => {
          const meta = GROUP_PANEL_META[panel.group]
          const showPanelHeader = panels.length > 1 || isGatewayTab || meta?.danger
          const danger = Boolean(meta?.danger)
          return (
            <section
              key={panel.group}
              className={`overflow-hidden rounded-2xl border bg-white shadow-card ${
                danger ? 'border-red-200' : 'border-gray-100'
              }`}
            >
              {showPanelHeader && (
                <header className="border-b border-gray-100 px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {meta ? translateDynamic(`groupMeta.${panel.group}.title`) : translateDynamic(`tabs.${tab.key}`)}
                    </h3>
                    {danger && <MetaBadge tone="red">高风险</MetaBadge>}
                  </div>
                  {(() => {
                    const panelDescription = meta
                      ? translateDynamic(`groupMeta.${panel.group}.description`)
                      : panels.length > 1
                        ? translateDynamic(`tabDescriptions.${tab.key}`)
                        : undefined
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

  // ---- 自定义 Tab 导航 — 复刻 sub2api settings-tabs 风格 ----
  const renderSettingsTabs = () => (
    <div className="settings-tabs-shell">
      <nav
        ref={tabsScrollRef}
        className="settings-tabs-scroll"
        role="tablist"
        aria-label={t('title')}
      >
        <div className="settings-tabs">
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.key
            const tabItems = itemsForTab(tab, settings)
            const isTabDirty = hasDirtyKeys(tabItems.map((s) => s.key))
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`settings-tab ${isActive ? 'settings-tab-active' : ''}`}
                onClick={() => selectTab(tab.key)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const currentIndex = visibleTabs.findIndex((item) => item.key === tab.key)
                  if (currentIndex < 0) return
                  const nextIndex = event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? visibleTabs.length - 1
                      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length
                  const nextTab = visibleTabs[nextIndex]
                  selectTab(nextTab.key)
                  const nextButton = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                    `[data-settings-tab="${nextTab.key}"]`,
                  )
                  nextButton?.focus()
                }}
                data-settings-tab={tab.key}
              >
                <span className="settings-tab-icon">
                  <SettingsTabIcon tabKey={tab.key} />
                </span>
                <span className="settings-tab-label">{translateDynamic(`tabs.${tab.key}`)}</span>
                {isTabDirty && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                )}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )

  return (
    <div className="admin-settings-page flex h-full min-h-0 flex-col overflow-hidden" data-testid="admin-settings-page">
      {/* 页面标题区 */}
      <header
        className="admin-settings-header flex flex-shrink-0 flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-6 py-4 sm:px-8"
        data-testid="admin-settings-header"
      >
        <div>
          <h2 className="text-lg font-bold text-gray-900">{t('title')}</h2>
          <p className="mt-0.5 text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          <Checkbox
            checked={showKeys}
            onChange={(e) => setShowKeys(e.target.checked)}
            className="hidden text-xs text-gray-400 sm:flex"
          >
            {t('showKeys')}
          </Checkbox>
          <Button size="small" onClick={() => void load()} disabled={loading}>
            {t('refresh')}
          </Button>
        </div>
      </header>

      {/* 内容区 */}
      <div className="admin-settings-content flex-1 overflow-y-auto bg-slate-50" data-testid="admin-settings-content">
        <div className="admin-settings-content-inner px-6 pb-16 pt-4 sm:px-8">
          {loading && (
            <Spin spinning size="large" className="flex w-full justify-center py-12">
              <div className="min-h-[200px]" />
            </Spin>
          )}

          {!loading && loadFailed && settings.length === 0 && (
            <Result
              status="error"
              title={t('loadFailed')}
              subTitle={loadError ?? undefined}
              extra={
                <Button type="primary" onClick={() => void load()}>
                  {t('retry')}
                </Button>
              }
            />
          )}

          {!loading && !loadFailed && settings.length === 0 && (
            <div className="py-24 text-center text-gray-400">{t('noSettings')}</div>
          )}

          {!loading && visibleTabs.length > 0 && (
            <>
              {renderSettingsTabs()}
              <div className="admin-settings-panel-region" data-testid="admin-settings-panel-region">
                {visibleTabs.map((tab) => (
                  <div key={tab.key} className="admin-settings-tab-panel" hidden={tab.key !== activeTab}>
                    {renderTabContent(tab)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 历史记录 Modal */}
      <Modal
        open={!!historyFor}
        title={`变更历史：${historyFor?.label ?? ''}`}
        onCancel={() => setHistoryFor(null)}
        footer={[
          <Button key="close" onClick={() => setHistoryFor(null)}>关闭</Button>
        ]}
        width={640}
      >
        {historyFor && showKeys && (
          <code className="mb-2 inline-block font-mono text-[10px] text-gray-400">{historyFor.key}</code>
        )}
        {historyLoading ? (
          <Skeleton active />
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-gray-400">暂无变更记录</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {history.map((h) => (
              <div key={h.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
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
      </Modal>

      {/* Step-up 密码验证 Modal：安全敏感配置保存时弹出 */}
      <StepUpPasswordModal
        visible={stepUpVisible}
        onConfirm={handleStepUpConfirm}
        onCancel={handleStepUpCancel}
      />

      {/* settings-tabs CSS 在 globals.css 中定义 */}
    </div>
  )
}

/**
 * useSearchParams 需要 Suspense 边界（Next.js App Router 预渲染要求）。
 */
export default function AdminSettingsView() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <AdminSettingsInner />
    </Suspense>
  )
}
