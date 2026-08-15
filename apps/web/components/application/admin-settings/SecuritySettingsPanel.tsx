'use client'

import { useCallback, useState } from 'react'
import { Input, Tag } from 'antd'
import {
  SettingField,
  SettingGrid,
  SettingsSaveFooter,
  SettingsSection,
  settingsDirty,
} from './SettingsPanelPrimitives'
import type { SettingsPanelProps } from './SettingsPanelPrimitives'

/** 注册设置 key 集合（auth 组中属于注册设置的 key）。 */
const REGISTRATION_KEYS = new Set([
  'auth.openRegistration',
  'auth.emailVerification',
  'auth.emailDomainWhitelist',
  'auth.nonWhitelistDomainLimit',
  'auth.enablePromoCode',
  'auth.requireInvitationCode',
  'auth.enablePasswordReset',
])

/** 邮箱域名白名单编辑器。 */
function EmailDomainWhitelistEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [input, setInput] = useState('')

  const parseDomains = useCallback((raw: string): string[] => {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      }
    } catch {
      // pass
    }
    return []
  }, [])

  const domains = parseDomains(value)

  const handleClose = (removed: string) => {
    const next = domains.filter((d) => d !== removed)
    onChange(JSON.stringify(next))
  }

  const handleInputConfirm = () => {
    const trimmed = input.trim()
    if (trimmed && !domains.includes(trimmed)) {
      onChange(JSON.stringify([...domains, trimmed]))
    }
    setInput('')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
        {domains.map((domain) => (
          <Tag
            key={domain}
            closable
            onClose={() => handleClose(domain)}
            className="!rounded-full !border-teal-200 !bg-teal-50 !text-teal-700"
          >
            {domain}
          </Tag>
        ))}
        {domains.length === 0 && (
          <span className="text-xs text-gray-400">留空则不限制邮箱域名</span>
        )}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onPressEnter={handleInputConfirm}
        onBlur={handleInputConfirm}
        placeholder="@example.com 或 *.edu.cn，回车添加"
        className="w-full"
      />
      <p className="text-[11px] text-gray-400">
        支持 @example.com 精确匹配域名，或 *.edu.cn 通配匹配域名及其子域名。
      </p>
    </div>
  )
}

export default function SecuritySettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved }: SettingsPanelProps) {
  const auth = settings.filter((setting) => setting.group === 'auth' && !REGISTRATION_KEYS.has(setting.key))
  const registrationSettings = settings.filter((setting) => REGISTRATION_KEYS.has(setting.key))
  const security = settings.filter((setting) => setting.group === 'security')

  const registrationToggleKeys = [
    'auth.openRegistration',
    'auth.emailVerification',
    'auth.nonWhitelistDomainLimit',
    'auth.enablePromoCode',
    'auth.requireInvitationCode',
    'auth.enablePasswordReset',
  ]
  const toggleSettings = registrationSettings.filter((s) => registrationToggleKeys.includes(s.key))
  const whitelistSetting = registrationSettings.find((s) => s.key === 'auth.emailDomainWhitelist')

  return (
    <div data-testid="security-settings-panel" className="space-y-5">
      <div className="text-sm leading-relaxed text-gray-500">配置登录认证和请求安全边界。高风险项保留后端权限、生产环境和 SSRF 校验。</div>

      {registrationSettings.length > 0 && (
        <SettingsSection title="注册设置" description="控制用户注册和验证。">
          <div className="grid gap-5 md:grid-cols-2">
            {toggleSettings.map((setting) => (
              <SettingField
                key={setting.key}
                setting={setting}
                value={drafts[setting.key] ?? setting.value}
                onChange={(value) => onDraftChange(setting.key, value)}
              />
            ))}
          </div>
          {whitelistSetting && (
            <label className="block text-xs text-gray-600">
              <span className="font-medium text-gray-800">{whitelistSetting.label}</span>
              {whitelistSetting.description && <span className="mt-1 block leading-relaxed text-gray-400">{whitelistSetting.description}</span>}
              <span className="mt-2 block">
                <EmailDomainWhitelistEditor
                  value={drafts[whitelistSetting.key] ?? whitelistSetting.value}
                  onChange={(value) => onDraftChange(whitelistSetting.key, value)}
                />
              </span>
            </label>
          )}
        </SettingsSection>
      )}

      {auth.length > 0 && <SettingsSection title="登录认证" description="Turnstile 仅在服务端密钥和前端站点密钥均可用时提供完整保护。"><SettingGrid settings={auth} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      {security.length > 0 && <SettingsSection title="安全防护" description="限流与 SSRF 防护策略。降低安全边界可能影响所有 Provider 和远程媒体请求。" danger><SettingGrid settings={security} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      <SettingsSaveFooter dirty={settingsDirty(settings, drafts)} saving={saving} saved={saved} onSave={() => void onBatchSave(settings.map((setting) => setting.key))} note="安全配置保存后按注册表标记生效；高风险变更会记录历史。" />
    </div>
  )
}
