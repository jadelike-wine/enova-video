'use client'

import {
  SettingGrid,
  SettingsSaveFooter,
  SettingsSection,
  settingsDirty,
} from './SettingsPanelPrimitives'
import type { SettingsPanelProps } from './SettingsPanelPrimitives'

export default function SecuritySettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved }: SettingsPanelProps) {
  const auth = settings.filter((setting) => setting.group === 'auth')
  const security = settings.filter((setting) => setting.group === 'security')
  return (
    <div data-testid="security-settings-panel" className="space-y-5">
      <div className="text-sm leading-relaxed text-gray-500">配置登录认证和请求安全边界。高风险项保留后端权限、生产环境和 SSRF 校验。</div>
      {auth.length > 0 && <SettingsSection title="登录认证" description="Turnstile 仅在服务端密钥和前端站点密钥均可用时提供完整保护。"><SettingGrid settings={auth} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      {security.length > 0 && <SettingsSection title="安全防护" description="限流与 SSRF 防护策略。降低安全边界可能影响所有 Provider 和远程媒体请求。" danger><SettingGrid settings={security} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      <SettingsSaveFooter dirty={settingsDirty(settings, drafts)} saving={saving} saved={saved} onSave={() => void onBatchSave(settings.map((setting) => setting.key))} note="安全配置保存后按注册表标记生效；高风险变更会记录历史。" />
    </div>
  )
}
