'use client'

import { Input } from 'antd'

import CustomMenuEditor from './CustomMenuEditor.js'
import {
  SettingGrid,
  SettingsSaveFooter,
  SettingsSection,
  settingValue,
  settingsDirty,
} from './SettingsPanelPrimitives.js'
import type { SettingsPanelProps } from './SettingsPanelPrimitives.js'

export default function FeaturesSettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved }: SettingsPanelProps) {
  const find = (key: string) => settings.find((setting) => setting.key === key)
  const get = (key: string) => settingValue(settings, drafts, key)
  const byKeys = (keys: readonly string[]) => keys.map((key) => find(key)).filter((setting): setting is NonNullable<typeof setting> => Boolean(setting))
  const homepage = byKeys(['general.compactHomeEnabled', 'general.hideCcsImportButton'])
  const table = settings.filter((setting) => setting.group === 'table')
  const logs = settings.filter((setting) => setting.group === 'log')
  const homeContent = find('general.homeContent')
  const menu = find('general.customMenuItems')

  return (
    <div data-testid="features-settings-panel" className="space-y-5">
      <div className="text-sm leading-relaxed text-gray-500">管理首页展示、菜单、表格分页和日志偏好；结构化菜单使用字段编辑器维护。</div>
      {homeContent || homepage.length > 0 ? (
        <SettingsSection title="首页与功能开关" description="只展示 Enova 当前首页和导航中已有消费者的功能开关。">
          {homeContent && (
            <label className="block text-xs text-gray-600">
              <span className="font-medium text-gray-800">{homeContent.label}</span>
              <span className="mt-1 block text-gray-400">支持 Markdown/HTML；外部 iframe 内容请确认来源可信。</span>
              <Input.TextArea value={get(homeContent.key)} onChange={(event) => onDraftChange(homeContent.key, event.target.value)} autoSize={{ minRows: 5, maxRows: 14 }} className="mt-2 w-full" aria-label={homeContent.label} />
              <span className="mt-2 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">外部 iframe 可能带来内容安全风险，请仅使用可信地址。</span>
            </label>
          )}
          {homepage.length > 0 && <SettingGrid settings={homepage} drafts={drafts} onDraftChange={onDraftChange} />}
        </SettingsSection>
      ) : null}
      {menu && (
        <SettingsSection title="自定义菜单页面" description="用字段编辑菜单名称、URL、可见范围、启用状态和排序，不需要手写 JSON。">
          <CustomMenuEditor value={get(menu.key)} onChange={(value) => onDraftChange(menu.key, value)} />
        </SettingsSection>
      )}
      {table.length > 0 && <SettingsSection title="通用表格设置" description="统一控制后台与用户侧表格组件的默认分页行为。"><SettingGrid settings={table} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      {logs.length > 0 && <SettingsSection title="日志与可观测性" description="日志级别、格式和敏感内容记录开关。"><SettingGrid settings={logs} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      <SettingsSaveFooter dirty={settingsDirty(settings, drafts)} saving={saving} saved={saved} onSave={() => void onBatchSave(settings.map((setting) => setting.key))} />
    </div>
  )
}
