/** @vitest-environment jsdom */

import React, { type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AdminSettingsView from './AdminSettingsView'

// Vitest keeps this workspace's JSX in classic mode while Next compiles it with
// the automatic runtime in production.
;(globalThis as typeof globalThis & { React: typeof React }).React = React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

const { fixtureSettings, routerReplace, searchParams } = vi.hoisted(() => {
  const settings = [
    ['general.siteName', 'general', 'string'],
    ['general.loginAgreementEnabled', 'general', 'boolean'],
    ['general.homeContent', 'customization', 'string'],
    ['auth.turnstileEnabled', 'auth', 'boolean'],
    ['billing.welcomeCredits', 'billing', 'number'],
    ['queue.concurrency', 'queue', 'number'],
    ['payment.mode', 'payment', 'enum'],
    ['email.smtpHost', 'email', 'string'],
    ['storage.provider', 'storage', 'enum'],
  ]

  return {
    fixtureSettings: settings.map(([key, group, valueType]) => ({
      key,
      group,
      valueType,
      label: key,
      description: `Description for ${key}`,
      value: valueType === 'boolean' ? 'false' : valueType === 'number' ? '10' : '',
      isSecret: false,
      options: valueType === 'enum' ? ['sandbox', 'none'] : undefined,
      persisted: false,
      configured: false,
    })),
    routerReplace: vi.fn(),
    searchParams: new URLSearchParams(),
  }
})

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('antd', () => {
  const element = (tag: string, props: Record<string, unknown> = {}, children?: ReactNode) =>
    React.createElement(tag, props, children)
  const Button = ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    element('button', props, children)
  const Input = ({ value, onChange, ...props }: { value?: string; onChange?: (event: unknown) => void; [key: string]: unknown }) =>
    element('input', { ...props, value, onChange })
  Input.TextArea = ({ value, onChange, autoSize, ...props }: { value?: string; onChange?: (event: unknown) => void; autoSize?: unknown; [key: string]: unknown }) => {
    void autoSize
    return element('textarea', { ...props, value, onChange })
  }
  Input.Password = ({ value, onChange, ...props }: { value?: string; onChange?: (event: unknown) => void; [key: string]: unknown }) =>
    element('input', { ...props, type: 'password', value, onChange })
  const InputNumber = ({ value, onChange, ...props }: { value?: string; onChange?: (value: string) => void; [key: string]: unknown }) =>
    element('input', { ...props, type: 'number', value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) })
  const Select = ({ value, onChange, options = [], ...props }: { value?: string; onChange?: (value: string) => void; options?: Array<{ value: string; label: string }>; [key: string]: unknown }) =>
    element('select', { ...props, value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) }, options.map((option) => element('option', { key: option.value, value: option.value }, option.label)))
  const Segmented = ({ value, onChange, options = [] }: { value?: string; onChange?: (value: string) => void; options?: Array<{ value: string; label: string }> }) =>
    element('div', {}, options.map((option) => element('button', { key: option.value, type: 'button', 'aria-pressed': value === option.value, onClick: () => onChange?.(option.value) }, option.label)))
  const Checkbox = ({ children, checked, onChange, ...props }: { children?: ReactNode; checked?: boolean; onChange?: (event: { target: { checked: boolean } }) => void; [key: string]: unknown }) =>
    element('label', {}, [element('input', { key: 'input', ...props, type: 'checkbox', checked, onChange: (event: { target: { checked: boolean } }) => onChange?.(event) }), element('span', { key: 'label' }, children)])
  const Switch = ({ checked, onChange, ...props }: { checked?: boolean; onChange?: (checked: boolean) => void; [key: string]: unknown }) =>
    element('button', { ...props, type: 'button', role: 'switch', 'aria-checked': checked, onClick: () => onChange?.(!checked) }, checked ? 'on' : 'off')
  const DatePicker = ({ value, onChange, ...props }: { value?: unknown; onChange?: (value: unknown) => void; [key: string]: unknown }) =>
    element('input', { ...props, type: 'date', 'data-testid': 'date-picker', value: typeof value === 'object' && value !== null ? String(value) : '', onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) })
  const Skeleton = () => element('div', {}, 'Loading')
  const Spin = ({ children, spinning, ...props }: { children?: ReactNode; spinning?: boolean; [key: string]: unknown }) => {
    void spinning
    return element('div', props, children)
  }
  const Result = ({ title, subTitle, extra, ...props }: { title?: ReactNode; subTitle?: ReactNode; extra?: ReactNode; [key: string]: unknown }) =>
    element('div', props, [title, subTitle, extra].filter(Boolean))
  const Alert = ({ title, message, description, ...props }: { title?: ReactNode; message?: ReactNode; description?: ReactNode; [key: string]: unknown }) =>
    element('div', props, [title ?? message, description].filter(Boolean))
  const Tag = ({ children }: { children?: ReactNode }) => element('span', {}, children)
  const Modal = ({ open, children }: { open?: boolean; children?: ReactNode }) => open ? element('div', {}, children) : null

  return { Alert, Button, Checkbox, DatePicker, Input, InputNumber, Modal, Result, Segmented, Select, Skeleton, Spin, Switch, Tag }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/admin/settings',
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => searchParams,
}))

vi.mock('dayjs', () => {
  function dayjsMock(date?: string | Date | null) {
    const d = date ? new Date(date) : new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const obj = {
      isValid: () => !Number.isNaN(d.getTime()),
      format: (fmt: string) => {
        const y = d.getFullYear()
        const m = pad(d.getMonth() + 1)
        const day = pad(d.getDate())
        return (fmt || 'YYYY-MM-DD')
          .replace('YYYY', String(y))
          .replace('MM', m)
          .replace('DD', day)
      },
    }
    return obj
  }
  return { default: dayjsMock }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    title: '系统设置',
    subtitle: '动态配置保存后立即生效；未修改的项使用环境变量或默认值。',
    showKeys: '显示配置 key',
    refresh: '刷新',
    saveModified: '保存修改',
    saving: '保存中…',
    saved: '已保存',
    noSaveNeeded: '无需保存',
    loadFailed: '配置加载失败',
    retry: '重试',
    noSettings: '暂无配置项',
  }[key] ?? key),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    React.createElement('a', props as React.AnchorHTMLAttributes<HTMLAnchorElement>, children),
}))

vi.mock('./DialogProvider', () => ({
  useDialog: () => ({
    alert: vi.fn().mockResolvedValue(true),
    confirm: vi.fn().mockResolvedValue(true),
  }),
}))

vi.mock('../../lib/auth', () => ({
  useSession: () => ({ user: { role: 'ADMIN' } }),
}))

vi.mock('../../lib/api', () => ({
  settingsApi: {
    list: vi.fn().mockResolvedValue(fixtureSettings),
    update: vi.fn(),
    batchUpdate: vi.fn(),
    clearSecret: vi.fn(),
    history: vi.fn().mockResolvedValue([]),
    testStorage: vi.fn(),
  },
}))

vi.mock('./admin/AdminUi', () => ({
  ContentLoading: () => <div>Loading</div>,
}))

vi.mock('./AgreementDocumentsEditor', () => ({
  default: () => <div>Agreement editor</div>,
  normalizeDocumentsJson: (value: string) => value,
}))

vi.mock('./admin/EmailSettingsPanel', () => ({
  default: () => <div>Email settings panel</div>,
}))

async function renderSettingsView(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  root.render(<AdminSettingsView />)
  await new Promise((resolve) => setTimeout(resolve, 200))

  return { container, root }
}

afterEach(() => {
  document.body.innerHTML = ''
  routerReplace.mockClear()
  consoleError.mockClear()
})

describe('AdminSettingsView outer shell', () => {
  it('renders the settings workbench shell with all tabs and outer controls', async () => {
    const { container, root } = await renderSettingsView()

    expect(container.querySelector('[data-testid="admin-settings-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="admin-settings-header"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="admin-settings-content"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="admin-settings-panel-region"]')).not.toBeNull()
    expect(container.querySelector('h2')?.textContent).toBe('系统设置')
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(9)
    expect(container.querySelectorAll('.settings-tab-icon svg')).toHaveLength(9)
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.classList.contains('settings-tab-active')).toBe(true)
    expect(container.textContent).toContain('显示配置 key')
    expect(container.textContent).toContain('刷新')
    expect(container.textContent).toContain('无需保存')

    root.unmount()
  })
})
