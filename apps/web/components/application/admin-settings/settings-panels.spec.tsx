/** @vitest-environment jsdom */

import React, { type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS } from '../../../../../packages/db/src/settings-registry.js'
import type { SettingView } from '../../../lib/api'
import { itemsForTab, SETTINGS_TABS } from './settings-tabs.js'
import AgreementSettingsPanel from './AgreementSettingsPanel'
import FeaturesSettingsPanel from './FeaturesSettingsPanel'
import SecuritySettingsPanel from './SecuritySettingsPanel'
import UserDefaultsSettingsPanel from './UserDefaultsSettingsPanel'
import GatewaySettingsPanel from './GatewaySettingsPanel'
import PaymentSettingsPanel from './PaymentSettingsPanel'
import BackupSettingsPanel from './BackupSettingsPanel'

;(globalThis as typeof globalThis & { React: typeof React }).React = React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('antd', () => {
  const element = (tag: string, props: Record<string, unknown> = {}, children?: ReactNode) =>
    React.createElement(tag, props, children)
  const Button = ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean; [key: string]: unknown }) => {
    void loading
    return element('button', props, children)
  }
  const Input = ({ value, onChange, ...props }: { value?: string; onChange?: (event: unknown) => void; [key: string]: unknown }) =>
    element('input', { ...props, value, onChange })
  Input.TextArea = ({ value, onChange, autoSize, ...props }: { value?: string; onChange?: (event: unknown) => void; autoSize?: unknown; [key: string]: unknown }) => {
    void autoSize
    return element('textarea', { ...props, value, onChange })
  }
  Input.Password = Input
  const InputNumber = ({ value, onChange, ...props }: { value?: string | number; onChange?: (value: unknown) => void; [key: string]: unknown }) =>
    element('input', { ...props, type: 'number', value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) })
  const Select = ({ value, onChange, options = [], ...props }: { value?: string; onChange?: (value: string) => void; options?: Array<{ value: string; label: string }>; [key: string]: unknown }) =>
    element('select', { ...props, value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) }, options.map((option) => element('option', { key: option.value, value: option.value }, option.label)))
  const Switch = ({ checked, onChange, ...props }: { checked?: boolean; onChange?: (checked: boolean) => void; [key: string]: unknown }) =>
    element('button', { ...props, type: 'button', role: 'switch', 'aria-checked': checked, onClick: () => onChange?.(!checked) }, checked ? 'on' : 'off')
  const Segmented = ({ value, onChange, options = [], ...props }: { value?: string; onChange?: (value: string) => void; options?: Array<{ value: string; label: string }>; [key: string]: unknown }) =>
    element('select', { ...props, value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) }, options.map((option) => element('option', { key: option.value, value: option.value }, option.label)))
  const Tag = ({ children }: { children?: ReactNode }) => element('span', {}, children)
  const Empty = ({ description }: { description?: ReactNode }) => element('div', {}, description)
  return { Button, Input, InputNumber, Select, Switch, Segmented, Tag, Empty }
})

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => React.createElement('a', props, children),
}))

function fixture(def: (typeof SETTINGS)[number]): SettingView {
  return {
    key: def.key,
    value: def.envDefault ?? (def.valueType === 'boolean' ? 'false' : def.options?.[0] ?? ''),
    valueType: def.valueType,
    group: def.group,
    label: def.label,
    description: def.description,
    isSecret: Boolean(def.isSecret),
    options: def.options,
    persisted: false,
    configured: false,
    min: def.min,
    max: def.max,
    restartRequired: def.restartRequired,
    permission: def.permission,
  }
}

const allSettings = SETTINGS.map(fixture)
const drafts = Object.fromEntries(allSettings.map((setting) => [setting.key, setting.value]))

function commonProps(settings: SettingView[]) {
  return {
    settings,
    drafts,
    onDraftChange: vi.fn(),
    onBatchSave: vi.fn(),
    saving: false,
    saved: false,
  }
}

async function renderPanels(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const byTab = (key: string) => itemsForTab(SETTINGS_TABS.find((tab) => tab.key === key)!, allSettings)

  await act(async () => {
    root.render(
      <>
        <AgreementSettingsPanel {...commonProps(byTab('agreement'))} />
        <FeaturesSettingsPanel {...commonProps(byTab('features'))} />
        <SecuritySettingsPanel {...commonProps(byTab('security'))} />
        <UserDefaultsSettingsPanel {...commonProps(byTab('users'))} />
        <GatewaySettingsPanel {...commonProps(byTab('gateway'))} />
        <PaymentSettingsPanel {...commonProps(byTab('payment'))} />
        <BackupSettingsPanel />
      </>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  return { container, root }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('business settings panels', () => {
  it('assigns every registered setting to exactly one tab', () => {
    for (const setting of allSettings) {
      const owners = SETTINGS_TABS.filter((tab) => itemsForTab(tab, [setting]).length > 0)
      expect(owners.map((tab) => tab.key), setting.key).toHaveLength(1)
    }
  })

  it('renders a business panel for each non-general settings tab', async () => {
    const { container, root } = await renderPanels()

    for (const testId of [
      'agreement-settings-panel',
      'features-settings-panel',
      'security-settings-panel',
      'users-settings-panel',
      'gateway-settings-panel',
      'payment-settings-panel',
      'backup-settings-panel',
    ]) {
      expect(container.querySelector(`[data-testid="${testId}"]`), testId).not.toBeNull()
    }
    expect(container.textContent).toContain('备份配置通过')

    await act(async () => root.unmount())
  })
})
