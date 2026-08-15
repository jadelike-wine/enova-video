'use client'

import { SettingGrid, SettingsSaveFooter, SettingsSection, settingsDirty } from './SettingsPanelPrimitives'
import type { SettingsPanelProps } from './SettingsPanelPrimitives'

export default function UserDefaultsSettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved }: SettingsPanelProps) {
  return (
    <div data-testid="users-settings-panel" className="space-y-5">
      <div className="text-sm leading-relaxed text-gray-500">只管理 Enova 已注册并由用户/钱包流程消费的新用户默认策略。</div>
      <SettingsSection title="新用户默认值" description="欢迎 Credits 会在新用户注册时写入对应 Workspace 钱包，不引入订阅或余额之外的 Gateway 业务。">
        <SettingGrid settings={settings} drafts={drafts} onDraftChange={onDraftChange} />
      </SettingsSection>
      <SettingsSaveFooter dirty={settingsDirty(settings, drafts)} saving={saving} saved={saved} onSave={() => void onBatchSave(settings.map((setting) => setting.key))} />
    </div>
  )
}
