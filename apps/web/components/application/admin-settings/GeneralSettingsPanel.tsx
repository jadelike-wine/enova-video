'use client'

import { Button, Input, InputNumber, Switch } from 'antd'
import type { ReactNode } from 'react'

import type { SettingView } from '../../../lib/api'
import { GENERAL_SECTIONS, settingBelongsToSection, type SettingsSectionDef } from './settings-tabs.js'
import CustomEndpointEditor from './CustomEndpointEditor.js'
import CustomMenuEditor from './CustomMenuEditor.js'
import LogoUploader from './LogoUploader.js'

export interface GeneralSettingsPanelProps {
  settings: SettingView[]
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
  onBatchSave: (keys: string[]) => void
  saving: boolean
  saved: boolean
}

function Section({ section, children }: { section: SettingsSectionDef; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      <header className="border-b border-gray-100 px-5 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>
        {section.description && <p className="mt-0.5 text-xs text-gray-500">{section.description}</p>}
      </header>
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
    </section>
  )
}

function Field({
  setting,
  value,
  onChange,
  wide = false,
}: {
  setting: SettingView
  value: string
  onChange: (value: string) => void
  wide?: boolean
}) {
  const control = setting.valueType === 'boolean' ? (
    <div className="flex min-h-10 items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-3">
      <span className="text-xs text-gray-500">{value === 'true' ? '已启用' : '已禁用'}</span>
      <Switch checked={value === 'true'} onChange={(checked) => onChange(checked ? 'true' : 'false')} aria-label={setting.label} />
    </div>
  ) : setting.valueType === 'number' ? (
    <InputNumber value={value} onChange={(next) => onChange(String(next ?? ''))} min={setting.min} max={setting.max} className="w-full" aria-label={setting.label} />
  ) : (
    <Input value={value} onChange={(event) => onChange(event.target.value)} type={setting.isSecret ? 'password' : 'text'} aria-label={setting.label} className="w-full" />
  )

  return (
    <label className={`block text-xs text-gray-600 ${wide ? 'md:col-span-2' : ''}`}>
      <span className="font-medium text-gray-800">{setting.label}</span>
      {setting.description && <span className="mt-1 block leading-relaxed text-gray-400">{setting.description}</span>}
      <span className="mt-2 block">{control}</span>
    </label>
  )
}

function SettingGrid({
  items,
  drafts,
  onDraftChange,
}: {
  items: SettingView[]
  drafts: Record<string, string>
  onDraftChange: (key: string, value: string) => void
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {items.map((setting) => (
        <Field key={setting.key} setting={setting} value={drafts[setting.key] ?? setting.value} onChange={(value) => onDraftChange(setting.key, value)} />
      ))}
    </div>
  )
}

export default function GeneralSettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved }: GeneralSettingsPanelProps) {
  const getValue = (key: string) => drafts[key] ?? settings.find((setting) => setting.key === key)?.value ?? ''
  const getSetting = (key: string) => settings.find((setting) => setting.key === key)
  const keys = settings.map((setting) => setting.key)
  const dirty = settings.some((setting) => (drafts[setting.key] ?? setting.value) !== setting.value)

  const itemsForSection = (section: SettingsSectionDef) => settings.filter((setting) => settingBelongsToSection(setting, section))
  const section = (key: string) => GENERAL_SECTIONS.find((candidate) => candidate.key === key)!

  const brandingItems = itemsForSection(section('branding')).filter((setting) => setting.key !== 'general.siteLogo')
  const supportItems = itemsForSection(section('support'))
  const tableItems = itemsForSection(section('table'))
  const homepageItems = itemsForSection(section('homepage')).filter((setting) => setting.key !== 'general.homeContent')
  const endpointItems = itemsForSection(section('endpoints')).filter((setting) => setting.key !== 'general.customEndpoints')

  return (
    <div data-testid="general-settings-panel" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">配置站点品牌、客服入口、首页内容和可扩展的菜单与端点。</p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs font-medium text-emerald-600">已保存</span>}
          <Button data-testid="general-settings-save" type="primary" size="small" disabled={!dirty} loading={saving} onClick={() => onBatchSave(keys)}>
            {saving ? '保存中…' : saved ? '已保存' : '保存修改'}
          </Button>
        </div>
      </div>

      {(brandingItems.length > 0 || getSetting('general.siteLogo')) && (
        <Section section={section('branding')}>
          <SettingGrid items={brandingItems} drafts={drafts} onDraftChange={onDraftChange} />
          {getSetting('general.siteLogo') && (
            <div className="border-t border-gray-100 pt-5">
              <div className="mb-2 text-xs font-medium text-gray-800">{getSetting('general.siteLogo')?.label}</div>
              <p className="mb-3 text-xs text-gray-400">支持通过图片文件或现有 URL 配置站点 Logo。</p>
              <LogoUploader value={getValue('general.siteLogo')} onChange={(value) => onDraftChange('general.siteLogo', value)} />
            </div>
          )}
        </Section>
      )}

      {tableItems.length > 0 && <Section section={section('table')}><SettingGrid items={tableItems} drafts={drafts} onDraftChange={onDraftChange} /></Section>}

      {endpointItems.length > 0 || getSetting('general.customEndpoints') ? (
        <Section section={section('endpoints')}>
          {endpointItems.length > 0 && <SettingGrid items={endpointItems} drafts={drafts} onDraftChange={onDraftChange} />}
          {getSetting('general.customEndpoints') && (
            <div className={endpointItems.length > 0 ? 'border-t border-gray-100 pt-5' : ''}>
              <div className="mb-2 text-xs font-medium text-gray-800">{getSetting('general.customEndpoints')?.label}</div>
              <p className="mb-3 text-xs text-gray-400">新增端点时只需填写字段，URL 先做基础格式校验，最终安全校验由 API 执行。</p>
              <CustomEndpointEditor value={getValue('general.customEndpoints')} onChange={(value) => onDraftChange('general.customEndpoints', value)} />
            </div>
          )}
        </Section>
      ) : null}

      {supportItems.length > 0 && <Section section={section('support')}><SettingGrid items={supportItems} drafts={drafts} onDraftChange={onDraftChange} /></Section>}

      {(homepageItems.length > 0 || getSetting('general.homeContent')) && (
        <Section section={section('homepage')}>
          {getSetting('general.homeContent') && (
            <label className="block text-xs text-gray-600">
              <span className="font-medium text-gray-800">{getSetting('general.homeContent')?.label}</span>
              <span className="mt-1 block leading-relaxed text-gray-400">支持 Markdown/HTML；以 http:// 或 https:// 开头时将作为 iframe 地址加载。</span>
              <Input.TextArea value={getValue('general.homeContent')} onChange={(event) => onDraftChange('general.homeContent', event.target.value)} autoSize={{ minRows: 5, maxRows: 14 }} aria-label={getSetting('general.homeContent')?.label} className="mt-2 w-full" />
              <span className="mt-2 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">iframe 内容来自外部页面时，请确认来源可信并注意内容安全风险。</span>
            </label>
          )}
          {homepageItems.length > 0 && <SettingGrid items={homepageItems} drafts={drafts} onDraftChange={onDraftChange} />}
        </Section>
      )}

      {getSetting('general.customMenuItems') && (
        <Section section={section('menu')}>
          <div>
            <div className="mb-2 text-xs font-medium text-gray-800">{getSetting('general.customMenuItems')?.label}</div>
            <p className="mb-3 text-xs text-gray-400">用字段编辑菜单，保存时自动按排序值稳定序列化。</p>
            <CustomMenuEditor value={getValue('general.customMenuItems')} onChange={(value) => onDraftChange('general.customMenuItems', value)} />
          </div>
        </Section>
      )}
    </div>
  )
}
