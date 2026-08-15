'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, InputNumber, Select, Switch } from 'antd'
import {
  emailApi,
  type EmailEventMeta,
  type EmailTemplateListResponse,
  type SettingView,
} from '../../../lib/api'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface EmailSettingsPanelProps {
  settings: SettingView[]
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
  onBatchSave: (keys: string[]) => Promise<void> | void
  saving: boolean
  saved: boolean
}

// ---------------------------------------------------------------------------
// 邮件事件显示元数据
// ---------------------------------------------------------------------------

const EVENT_DISPLAY_META: Record<string, { label: string; category: string; timing: string; optional: boolean }> = {
  'auth.verify_code': {
    label: '邮箱验证码',
    category: '认证安全',
    timing: '注册、绑定邮箱、OAuth 补全邮箱或 TOTP 邮箱校验时发送。',
    optional: false,
  },
  'auth.password_reset': {
    label: '密码重置',
    category: '认证安全',
    timing: '用户请求密码重置链接时发送。',
    optional: false,
  },
  'subscription.expiry_reminder': {
    label: '订阅到期提醒',
    category: '订阅',
    timing: '后台任务在订阅仍有效且距离到期剩余 7 天、3 天、1 天时各发送一次，可通过邮件设置中的开关关闭。',
    optional: true,
  },
  'balance.low': {
    label: '余额不足提醒',
    category: '计费',
    timing: '用户余额低于全局或个人配置的提醒阈值时发送。',
    optional: true,
  },
  'balance.recharge_success': {
    label: '余额充值成功',
    category: '计费',
    timing: '余额充值订单支付完成并入账后发送。',
    optional: false,
  },
}

function formatLocale(locale: string): string {
  const lower = locale.toLowerCase()
  if (lower === 'zh' || lower.startsWith('zh-')) return '中文'
  if (lower === 'en' || lower.startsWith('en-')) return 'English'
  return locale
}

function formatCategory(category: string): string {
  if (!category) return '通知'
  const labels: Record<string, string> = {
    auth: '认证安全',
    subscription: '订阅',
    billing: '计费',
    admin: '管理告警',
    risk_control: '风控',
    ops: '运维',
  }
  return labels[category] ?? category
}

// ---------------------------------------------------------------------------
// SMTP 设置卡片
// ---------------------------------------------------------------------------

function SmtpSettingsCard({
  settings,
  drafts,
  onDraftChange,
}: {
  settings: SettingView[]
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
}) {
  const { alert } = useDialog()
  const [testing, setTesting] = useState(false)
  const findSetting = (key: string) => settings.find((s) => s.key === key)
  const getDraft = useCallback((key: string) => drafts[key] ?? '', [drafts])
  const isPasswordConfigured = Boolean(findSetting('email.smtpPassword')?.configured)

  const handleTestConnection = useCallback(async () => {
    setTesting(true)
    try {
      const portStr = getDraft('email.smtpPort')
      const secureStr = getDraft('email.smtpSecure')
      const result = await emailApi.testSmtpConnection({
        host: getDraft('email.smtpHost') || undefined,
        port: portStr ? Number(portStr) : undefined,
        secure: secureStr === 'true' ? true : secureStr === 'false' ? false : undefined,
        user: getDraft('email.smtpUser') || undefined,
        password: getDraft('email.smtpPassword') || undefined,
      })
      await alert({ title: '连接成功', message: result.message })
    } catch (e) {
      await alert({ title: '连接失败', message: formatErrorMessage(e) })
    } finally {
      setTesting(false)
    }
  }, [alert, getDraft])

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">SMTP 配置</h3>
          <p className="mt-1 text-sm text-gray-500">生产环境邮件发信服务配置。</p>
        </div>
        <Button
          size="small"
          loading={testing}
          onClick={() => void handleTestConnection()}
        >
          {testing ? '测试中…' : '测试连接'}
        </Button>
      </header>
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* SMTP 主机 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">SMTP 主机</label>
            <Input
              value={getDraft('email.smtpHost')}
              onChange={(e) => onDraftChange('email.smtpHost', e.target.value)}
              placeholder="smtp.example.com"
            />
          </div>
          {/* SMTP 端口 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">SMTP 端口</label>
            <InputNumber
              value={getDraft('email.smtpPort') ? Number(getDraft('email.smtpPort')) : undefined}
              onChange={(val) => onDraftChange('email.smtpPort', String(val ?? ''))}
              min={1}
              max={65535}
              className="w-full"
              placeholder="587"
            />
          </div>
          {/* SMTP 用户名 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">SMTP 用户名</label>
            <Input
              value={getDraft('email.smtpUser')}
              onChange={(e) => onDraftChange('email.smtpUser', e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          {/* SMTP 密码 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">SMTP 密码</label>
            <Input.Password
              value={getDraft('email.smtpPassword')}
              onChange={(e) => onDraftChange('email.smtpPassword', e.target.value)}
              placeholder={isPasswordConfigured ? '••••••（留空保持不变）' : '输入 SMTP 密码'}
              autoComplete="new-password"
            />
            <p className="mt-1.5 text-xs text-gray-500">
              {isPasswordConfigured
                ? '已加密存储：留空保持不变，输入新值覆盖'
                : '敏感字段，AES-GCM 加密存储'}
            </p>
          </div>
          {/* 发件人邮箱 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">发件人邮箱</label>
            <Input
              value={getDraft('email.smtpFromEmail')}
              onChange={(e) => onDraftChange('email.smtpFromEmail', e.target.value)}
              type="email"
              placeholder="noreply@example.com"
            />
          </div>
          {/* 发件人名称 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">发件人名称</label>
            <Input
              value={getDraft('email.smtpFromName')}
              onChange={(e) => onDraftChange('email.smtpFromName', e.target.value)}
              placeholder="EnovaMotion"
            />
          </div>
        </div>

        {/* TLS Toggle */}
        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <div>
            <label className="font-medium text-gray-900">使用 TLS 直连</label>
            <p className="text-sm text-gray-500">465 端口通常开启，587 端口通常关闭并使用 STARTTLS。</p>
          </div>
          <Switch
            checked={getDraft('email.smtpSecure') === 'true'}
            onChange={(checked) => onDraftChange('email.smtpSecure', checked ? 'true' : 'false')}
          />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 测试邮件卡片
// ---------------------------------------------------------------------------

function TestEmailCard() {
  const { alert } = useDialog()
  const [testEmail, setTestEmail] = useState('')
  const [sending, setSending] = useState(false)

  const handleSendTest = useCallback(async () => {
    if (!testEmail.trim()) return
    setSending(true)
    try {
      const result = await emailApi.sendTestEmail(testEmail.trim())
      await alert({ title: '发送成功', message: result.message })
    } catch (e) {
      await alert({ title: '发送失败', message: formatErrorMessage(e) })
    } finally {
      setSending(false)
    }
  }, [testEmail, alert])

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      <header className="border-b border-gray-100 px-6 py-4">
        <h3 className="text-lg font-semibold text-gray-900">发送测试邮件</h3>
        <p className="mt-1 text-sm text-gray-500">使用当前保存的 SMTP 配置发送测试邮件，验证配置是否正确。</p>
      </header>
      <div className="p-6">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="mb-2 block text-sm font-medium text-gray-700">收件人邮箱</label>
            <Input
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              type="email"
              placeholder="recipient@example.com"
            />
          </div>
          <Button
            type="default"
            loading={sending}
            disabled={!testEmail.trim()}
            onClick={() => void handleSendTest()}
          >
            发送测试邮件
          </Button>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 订阅到期提醒卡片
// ---------------------------------------------------------------------------

function SubscriptionExpiryCard({
  drafts,
  onDraftChange,
}: {
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
}) {
  const enabled = drafts['email.subscriptionExpiryNotifyEnabled'] === 'true'

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      <header className="border-b border-gray-100 px-6 py-4">
        <h3 className="text-base font-medium text-gray-900">订阅到期提醒</h3>
        <p className="mt-1 text-sm text-gray-500">开启后，系统在订阅到期前 7 天、3 天、1 天发送提醒邮件。</p>
      </header>
      <div className="px-6 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className="mb-0 block text-sm font-medium text-gray-700">启用订阅到期提醒</label>
            <p className="mt-1 text-xs text-gray-500">开启后，有效订阅在到期前 7/3/1 天各发送一次提醒。</p>
          </div>
          <Switch
            checked={enabled}
            onChange={(checked) => onDraftChange('email.subscriptionExpiryNotifyEnabled', checked ? 'true' : 'false')}
          />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 余额不足提醒卡片
// ---------------------------------------------------------------------------

function BalanceLowCard({
  drafts,
  onDraftChange,
}: {
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
}) {
  const enabled = drafts['email.balanceLowNotifyEnabled'] === 'true'

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      <header className="border-b border-gray-100 px-6 py-4">
        <h3 className="text-base font-medium text-gray-900">余额不足提醒</h3>
        <p className="mt-1 text-sm text-gray-500">用户余额低于阈值时发送提醒邮件。</p>
      </header>
      <div className="space-y-4 px-6 py-6">
        <div className="flex items-center justify-between">
          <label className="mb-0 block text-sm font-medium text-gray-700">启用余额不足提醒</label>
          <Switch
            checked={enabled}
            onChange={(checked) => onDraftChange('email.balanceLowNotifyEnabled', checked ? 'true' : 'false')}
          />
        </div>
        {enabled && (
          <>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">提醒阈值</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">¥</span>
                <InputNumber
                  value={drafts['email.balanceLowNotifyThreshold'] ? Number(drafts['email.balanceLowNotifyThreshold']) : undefined}
                  onChange={(val) => onDraftChange('email.balanceLowNotifyThreshold', String(val ?? ''))}
                  min={0}
                  step={0.01}
                  className="w-full pl-7"
                  placeholder="0"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">用户余额低于此值时触发提醒（单位：元）。</p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">充值页面地址</label>
              <Input
                value={drafts['email.balanceLowNotifyRechargeUrl'] ?? ''}
                onChange={(e) => onDraftChange('email.balanceLowNotifyRechargeUrl', e.target.value)}
                type="url"
                placeholder={typeof window !== 'undefined' ? window.location.origin + '/app/wallet' : ''}
              />
              <p className="mt-1 text-xs text-gray-500">提醒邮件中引导用户充值的链接。</p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 账号限额通知卡片
// ---------------------------------------------------------------------------

function AccountQuotaCard({
  drafts,
  onDraftChange,
}: {
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
}) {
  const enabled = drafts['email.accountQuotaNotifyEnabled'] === 'true'
  const emailsStr = drafts['email.accountQuotaNotifyEmails'] || '[]'
  let emails: Array<{ email: string; disabled: boolean }> = []
  try {
    const parsed = JSON.parse(emailsStr)
    if (Array.isArray(parsed)) {
      emails = parsed.map((e: unknown) =>
        typeof e === 'string' ? { email: e, disabled: false } : { email: String((e as Record<string, unknown>)?.email ?? ''), disabled: Boolean((e as Record<string, unknown>)?.disabled) },
      )
    }
  } catch {
    emails = []
  }

  const updateEmails = (next: Array<{ email: string; disabled: boolean }>) => {
    onDraftChange('email.accountQuotaNotifyEmails', JSON.stringify(next))
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      <header className="border-b border-gray-100 px-6 py-4">
        <h3 className="text-base font-medium text-gray-900">账号限额通知</h3>
        <p className="mt-1 text-sm text-gray-500">特定条件下向管理员通知邮箱发送限额告警。</p>
      </header>
      <div className="space-y-4 px-6 py-6">
        <div className="flex items-center justify-between">
          <label className="mb-0 block text-sm font-medium text-gray-700">启用账号限额通知</label>
          <Switch
            checked={enabled}
            onChange={(checked) => onDraftChange('email.accountQuotaNotifyEnabled', checked ? 'true' : 'false')}
          />
        </div>
        {enabled && (
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">管理员通知邮箱</label>
            <div className="space-y-2">
              {emails.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Switch
                    size="small"
                    checked={!entry.disabled}
                    onChange={(checked) => {
                      const next = [...emails]
                      next[index] = { ...next[index], disabled: !checked }
                      updateEmails(next)
                    }}
                  />
                  <Input
                    value={entry.email}
                    onChange={(e) => {
                      const next = [...emails]
                      next[index] = { ...next[index], email: e.target.value }
                      updateEmails(next)
                    }}
                    type="email"
                    className="flex-1"
                    placeholder="admin@example.com"
                  />
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      const next = emails.filter((_, i) => i !== index)
                      updateEmails(next)
                    }}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                size="small"
                type="default"
                onClick={() => updateEmails([...emails, { email: '', disabled: false }])}
              >
                + 添加邮箱
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-500">接收账号限额告警的管理员邮箱列表。</p>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 邮件模板编辑器组件
// ---------------------------------------------------------------------------

function EmailTemplateEditor() {
  const { alert, confirm } = useDialog()
  const [loadingList, setLoadingList] = useState(true)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [eventOptions, setEventOptions] = useState<EmailEventMeta[]>([])
  const [localeOptions, setLocaleOptions] = useState<string[]>([])
  const [globalPlaceholders, setGlobalPlaceholders] = useState<string[]>([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [selectedLocale, setSelectedLocale] = useState('')
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [previewSubject, setPreviewSubject] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const initializingRef = useRef(false)

  const canSave = useMemo(
    () => Boolean(selectedEvent && selectedLocale) && subject.trim().length > 0 && html.trim().length > 0,
    [selectedEvent, selectedLocale, subject, html],
  )

  const canPreview = useMemo(
    () => Boolean(selectedEvent && selectedLocale) && html.trim().length > 0,
    [selectedEvent, selectedLocale, html],
  )

  const selectedEventMeta = useMemo(
    () => eventOptions.find((e) => e.event === selectedEvent) ?? null,
    [eventOptions, selectedEvent],
  )

  const placeholderList = useMemo(
    () => Array.from(new Set((placeholders.length ? placeholders : globalPlaceholders))),
    [placeholders, globalPlaceholders],
  )

  const loadTemplate = useCallback(async (event: string, locale: string) => {
    if (!event || !locale) return
    setLoadingTemplate(true)
    try {
      const tpl = await emailApi.getTemplate(event, locale)
      setSubject(tpl.subject)
      setHtml(tpl.html)
      setIsCustom(tpl.isCustom)
      setPlaceholders(tpl.placeholders || [])
      // 自动刷新预览
      const preview = await emailApi.previewTemplate({ event, locale, subject: tpl.subject, html: tpl.html })
      setPreviewSubject(preview.subject)
      setPreviewHtml(preview.html)
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoadingTemplate(false)
    }
  }, [alert])

  const loadTemplateList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res: EmailTemplateListResponse = await emailApi.getTemplateList()
      setEventOptions(res.events)
      setLocaleOptions(res.locales)
      setGlobalPlaceholders(res.placeholders || [])
      if (res.events.length > 0) {
        const initEvent = res.events[0].event
        const initLocale = res.locales.includes('zh') ? 'zh' : res.locales[0] || ''
        setSelectedEvent(initEvent)
        setSelectedLocale(initLocale)
        initializingRef.current = true
        await loadTemplate(initEvent, initLocale)
        initializingRef.current = false
      }
    } catch (e) {
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
    } finally {
      setLoadingList(false)
    }
  }, [alert, loadTemplate])

  useEffect(() => {
    void loadTemplateList()
  }, [loadTemplateList])

  // 事件或语言切换时重新加载模板
  useEffect(() => {
    if (initializingRef.current) return
    if (!selectedEvent || !selectedLocale) return
    void loadTemplate(selectedEvent, selectedLocale)
  }, [selectedEvent, selectedLocale, loadTemplate])

  const handleSaveTemplate = useCallback(async () => {
    if (!canSave) {
      await alert({ title: '提示', message: '主题和正文不能为空' })
      return
    }
    setSaving(true)
    try {
      const tpl = await emailApi.updateTemplate(selectedEvent, selectedLocale, {
        subject: subject,
        html: html,
      })
      setSubject(tpl.subject)
      setHtml(tpl.html)
      setIsCustom(tpl.isCustom)
      // 刷新预览
      const preview = await emailApi.previewTemplate({
        event: selectedEvent,
        locale: selectedLocale,
        subject: tpl.subject,
        html: tpl.html,
      })
      setPreviewSubject(preview.subject)
      setPreviewHtml(preview.html)
      await alert({ title: '保存成功', message: '邮件模板已保存。' })
    } catch (e) {
      await alert({ title: '保存失败', message: formatErrorMessage(e) })
    } finally {
      setSaving(false)
    }
  }, [canSave, selectedEvent, selectedLocale, subject, html, alert])

  const handleRefreshPreview = useCallback(async () => {
    if (!canPreview) return
    setPreviewing(true)
    try {
      const preview = await emailApi.previewTemplate({
        event: selectedEvent,
        locale: selectedLocale,
        subject,
        html,
      })
      setPreviewSubject(preview.subject)
      setPreviewHtml(preview.html)
    } catch (e) {
      await alert({ title: '预览失败', message: formatErrorMessage(e) })
    } finally {
      setPreviewing(false)
    }
  }, [canPreview, selectedEvent, selectedLocale, subject, html, alert])

  const handleRestoreOfficial = useCallback(async () => {
    if (!selectedEvent || !selectedLocale) return
    const ok = await confirm({
      title: '恢复官方模板',
      message: '确定恢复此邮件模板为官方默认版本？当前自定义内容将被覆盖。',
    })
    if (!ok) return
    setRestoring(true)
    try {
      const tpl = await emailApi.restoreOfficial(selectedEvent, selectedLocale)
      setSubject(tpl.subject)
      setHtml(tpl.html)
      setIsCustom(false)
      const preview = await emailApi.previewTemplate({
        event: selectedEvent,
        locale: selectedLocale,
        subject: tpl.subject,
        html: tpl.html,
      })
      setPreviewSubject(preview.subject)
      setPreviewHtml(preview.html)
      await alert({ title: '恢复成功', message: '已恢复为官方默认模板。' })
    } catch (e) {
      await alert({ title: '恢复失败', message: formatErrorMessage(e) })
    } finally {
      setRestoring(false)
    }
  }, [selectedEvent, selectedLocale, alert, confirm])

  const copyPlaceholder = useCallback(async (placeholder: string) => {
    try {
      await navigator.clipboard.writeText(placeholder)
      await alert({ title: '已复制', message: placeholder })
    } catch {
      await alert({ title: '复制失败', message: '请手动复制' })
    }
  }, [alert])

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      {/* 顶部操作区 */}
      <header className="flex flex-col gap-3 border-b border-gray-100 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">邮件模板</h3>
          <p className="mt-1 text-sm text-gray-500">编辑事务邮件的 HTML 模板，支持模板变量和实时预览。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="small"
            loading={previewing}
            disabled={loadingTemplate || !canPreview}
            onClick={() => void handleRefreshPreview()}
          >
            刷新预览
          </Button>
          <Button
            size="small"
            loading={restoring}
            disabled={loadingTemplate || !selectedEvent || !selectedLocale}
            onClick={() => void handleRestoreOfficial()}
          >
            恢复官方模板
          </Button>
          <Button
            type="primary"
            size="small"
            loading={saving}
            disabled={loadingTemplate || !canSave}
            onClick={() => void handleSaveTemplate()}
          >
            保存模板
          </Button>
        </div>
      </header>

      <div className="space-y-6 p-6">
        {loadingList ? (
          <div className="py-8 text-center text-gray-400">加载中…</div>
        ) : (
          <>
            {/* 事件和语言选择 */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="email-template-event">
                  事件
                </label>
                <Select
                  id="email-template-event"
                  value={selectedEvent}
                  onChange={(val) => setSelectedEvent(val as string)}
                  className="w-full"
                  disabled={loadingTemplate}
                  options={eventOptions.map((e) => ({
                    value: e.event,
                    label: e.label,
                  }))}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="email-template-locale">
                  语言
                </label>
                <Select
                  id="email-template-locale"
                  value={selectedLocale}
                  onChange={(val) => setSelectedLocale(val as string)}
                  className="w-full"
                  disabled={loadingTemplate}
                  options={localeOptions.map((l) => ({
                    value: l,
                    label: formatLocale(l),
                  }))}
                />
              </div>
            </div>

            {/* 模板信息提示区域 */}
            {selectedEventMeta && (
              <div className="rounded-lg border border-primary-100 bg-primary-50/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-gray-900">
                    {EVENT_DISPLAY_META[selectedEventMeta.event]?.label ?? selectedEventMeta.label}
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-gray-200">
                    {formatCategory(selectedEventMeta.category)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      selectedEventMeta.optional
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {selectedEventMeta.optional ? '可退订通知' : '事务邮件'}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {EVENT_DISPLAY_META[selectedEventMeta.event]?.timing ?? selectedEventMeta.description}
                </p>
              </div>
            )}

            {(!eventOptions.length || !localeOptions.length) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                暂无可用邮件模板。
              </div>
            )}

            {eventOptions.length > 0 && localeOptions.length > 0 && (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {/* 左侧：编辑区 */}
                <div className="space-y-4">
                  {/* 主题 */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="email-template-subject">
                      主题
                    </label>
                    <Input
                      id="email-template-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      disabled={loadingTemplate}
                      placeholder="邮件主题，支持模板变量"
                    />
                  </div>

                  {/* HTML 模板编辑器 */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="email-template-html">
                      HTML 模板
                    </label>
                    <textarea
                      id="email-template-html"
                      value={html}
                      onChange={(e) => setHtml(e.target.value)}
                      rows={18}
                      className="w-full min-h-[28rem] resize-y rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm leading-6 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                      disabled={loadingTemplate}
                      placeholder="在此编辑 HTML 模板内容…"
                    />
                  </div>

                  {/* 可用占位符 */}
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <div className="text-sm font-medium text-gray-900">可用占位符</div>
                    <p className="mt-1 text-xs text-gray-500">点击占位符可复制到剪贴板，粘贴到模板中使用。</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {placeholderList.map((placeholder) => (
                        <button
                          key={placeholder}
                          type="button"
                          className="rounded-full border border-gray-100 bg-white px-3 py-1 font-mono text-xs text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-600"
                          onClick={() => void copyPlaceholder(placeholder)}
                        >
                          {placeholder}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 右侧：实时预览 */}
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                      <div>
                        <div className="text-sm font-medium text-gray-900">实时预览</div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {previewSubject || '暂无预览'}
                        </div>
                      </div>
                      {isCustom && (
                        <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700">
                          已自定义
                        </span>
                      )}
                    </div>
                    <div className="bg-gray-100 p-3">
                      <iframe
                        className="h-[36rem] w-full rounded-md border border-gray-100 bg-white"
                        sandbox=""
                        srcDoc={previewHtml}
                        title="邮件预览"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">预览使用模拟数据替换模板变量，实际发送时使用真实数据。</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export default function EmailSettingsPanel({
  settings,
  drafts,
  onDraftChange,
  onBatchSave,
  saving,
  saved,
}: EmailSettingsPanelProps) {
  // 邮件相关的所有 settings keys（用于批量保存）
  const emailKeys = useMemo(() => settings.map((s) => s.key), [settings])
  const tabDirty = useMemo(() => {
    return settings.some((s) => {
      const draft = (drafts[s.key] ?? '').trim()
      if (s.isSecret && draft === '') return false
      return draft !== s.value
    })
  }, [settings, drafts])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">SMTP 发信服务、邮件模板与通知配置。</p>
        <Button
          type="primary"
          size="small"
          loading={saving}
          disabled={!tabDirty}
          onClick={() => void onBatchSave(emailKeys)}
        >
          {saving ? '保存中…' : saved ? '已保存' : tabDirty ? '保存修改' : '无需保存'}
        </Button>
      </div>

      {/* SMTP 基础配置 */}
      <SmtpSettingsCard settings={settings} drafts={drafts} onDraftChange={onDraftChange} />

      {/* 测试邮件 */}
      <TestEmailCard />

      {/* 订阅到期提醒 */}
      <SubscriptionExpiryCard drafts={drafts} onDraftChange={onDraftChange} />

      {/* 邮件模板编辑器 */}
      <EmailTemplateEditor />

      {/* 余额不足提醒 */}
      <BalanceLowCard drafts={drafts} onDraftChange={onDraftChange} />

      {/* 账号限额通知 */}
      <AccountQuotaCard drafts={drafts} onDraftChange={onDraftChange} />

      {/* 密码重置地址和邮箱验证地址 */}
      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
        <header className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">邮件链接地址</h3>
          <p className="mt-1 text-sm text-gray-500">邮件中使用的密码重置和邮箱验证链接地址。</p>
        </header>
        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">密码重置地址</label>
            <Input
              value={drafts['email.passwordResetUrl'] ?? ''}
              onChange={(e) => onDraftChange('email.passwordResetUrl', e.target.value)}
              placeholder="https://example.com/zh-CN/auth/reset-password"
            />
            <p className="mt-1 text-xs text-gray-500">邮件中密码重置链接的基础地址。</p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">邮箱验证地址</label>
            <Input
              value={drafts['email.emailVerifyUrl'] ?? ''}
              onChange={(e) => onDraftChange('email.emailVerifyUrl', e.target.value)}
              placeholder="https://example.com/zh-CN/auth/verify-email"
            />
            <p className="mt-1 text-xs text-gray-500">邮件中邮箱验证链接的基础地址。</p>
          </div>
        </div>
      </section>
    </div>
  )
}
