'use client'

import { Button, Input, InputNumber, Select, Switch } from 'antd'
import type { ReactNode } from 'react'

import type { SettingView } from '../../../lib/api'

export interface SettingsPanelProps {
  settings: SettingView[]
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
  onBatchSave: (keys: string[]) => Promise<void> | void
  saving: boolean
  saved: boolean
}

export function settingValue(settings: SettingView[], drafts: Record<string, string>, key: string): string {
  return drafts[key] ?? settings.find((setting) => setting.key === key)?.value ?? ''
}

export function settingsDirty(settings: SettingView[], drafts: Record<string, string>): boolean {
  return settings.some((setting) => {
    const draft = (drafts[setting.key] ?? '').trim()
    if (setting.isSecret && draft === '') return false
    return draft !== setting.value
  })
}

export function SettingsSection({
  title,
  description,
  children,
  danger = false,
}: {
  title: string
  description?: string
  children: ReactNode
  danger?: boolean
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-white shadow-card ${danger ? 'border-red-200' : 'border-gray-100'}`}
    >
      <header className="border-b border-gray-100 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {danger && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">高风险</span>}
        </div>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>}
      </header>
      {danger && (
        <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700 sm:mx-6">
          ⚠ 降低安全边界可能引入 SSRF、内网访问或登录防护风险，请确认影响范围后再保存。
        </div>
      )}
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
    </section>
  )
}

export function SettingField({
  setting,
  value,
  onChange,
  multiline = false,
}: {
  setting: SettingView
  value: string
  onChange: (value: string) => void
  multiline?: boolean
}) {
  let control: ReactNode
  if (setting.valueType === 'boolean') {
    control = (
      <div className="flex min-h-10 items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-3">
        <span className="text-xs text-gray-500">{value === 'true' ? '已启用' : '已禁用'}</span>
        <Switch checked={value === 'true'} onChange={(checked) => onChange(checked ? 'true' : 'false')} aria-label={setting.label} />
      </div>
    )
  } else if (setting.valueType === 'enum' && setting.options) {
    control = (
      <Select
        value={value}
        onChange={(next) => onChange(String(next))}
        options={setting.options.map((option) => ({ value: option, label: option }))}
        className="w-full"
        aria-label={setting.label}
      />
    )
  } else if (setting.valueType === 'number') {
    control = (
      <InputNumber
        value={value ? Number(value) : undefined}
        onChange={(next) => onChange(String(next ?? ''))}
        min={setting.min}
        max={setting.max}
        className="w-full"
        aria-label={setting.label}
      />
    )
  } else if (multiline) {
    control = (
      <Input.TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoSize={{ minRows: 4, maxRows: 12 }}
        className="w-full"
        aria-label={setting.label}
      />
    )
  } else {
    control = (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={setting.isSecret ? 'password' : 'text'}
        placeholder={setting.isSecret && setting.configured ? '••••••（留空保持不变）' : undefined}
        className="w-full"
        aria-label={setting.label}
      />
    )
  }

  return (
    <label className="block text-xs text-gray-600">
      <span className="font-medium text-gray-800">{setting.label}</span>
      {setting.description && <span className="mt-1 block leading-relaxed text-gray-400">{setting.description}</span>}
      {setting.isSecret && <span className="mt-1 block text-[11px] text-amber-600">{setting.configured ? '已加密存储：留空保持不变' : '敏感字段，AES-GCM 加密存储'}</span>}
      <span className="mt-2 block">{control}</span>
    </label>
  )
}

export function SettingGrid({
  settings,
  drafts,
  onDraftChange,
  multilineKeys = [],
}: {
  settings: SettingView[]
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
  multilineKeys?: readonly string[]
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {settings.map((setting) => (
        <SettingField
          key={setting.key}
          setting={setting}
          value={drafts[setting.key] ?? setting.value}
          onChange={(value) => onDraftChange(setting.key, value)}
          multiline={multilineKeys.includes(setting.key)}
        />
      ))}
    </div>
  )
}

export function SettingsSaveFooter({
  dirty,
  saving,
  saved,
  onSave,
  note,
}: {
  dirty: boolean
  saving: boolean
  saved: boolean
  onSave: () => void
  note?: string
}) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-card sm:px-6">
      <p className="text-xs text-gray-400">{note ?? '修改会通过当前 Tab 的原子批量操作保存。'}</p>
      <Button type="primary" size="small" disabled={!dirty} loading={saving} onClick={onSave}>
        {saving ? '保存中…' : saved ? '已保存' : dirty ? '保存修改' : '无需保存'}
      </Button>
    </footer>
  )
}
