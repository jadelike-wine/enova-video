/** @vitest-environment jsdom */

import React, { type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GeneralSettingsPanel from './GeneralSettingsPanel'
import type { SettingView } from '../../../lib/api'

;(globalThis as typeof globalThis & { React: typeof React }).React = React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('antd', () => {
  const element = (tag: string, props: Record<string, unknown> = {}, children?: ReactNode) =>
    React.createElement(tag, props, children)
  const Button = ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean; [key: string]: unknown }) => {
    void loading
    return element('button', props, children)
  }
  const Switch = ({ checked, onChange, ...props }: { checked?: boolean; onChange?: (checked: boolean) => void; [key: string]: unknown }) =>
    element('button', { ...props, type: 'button', role: 'switch', 'aria-checked': checked, onClick: () => onChange?.(!checked) }, checked ? 'on' : 'off')
  const Input = ({ value, onChange, ...props }: { value?: string; onChange?: (event: unknown) => void; [key: string]: unknown }) =>
    element('input', { ...props, value, onChange })
  Input.TextArea = ({ value, onChange, autoSize, ...props }: { value?: string; onChange?: (event: unknown) => void; autoSize?: unknown; [key: string]: unknown }) => {
    void autoSize
    return element('textarea', { ...props, value, onChange })
  }
  const InputNumber = ({ value, onChange, ...props }: { value?: string; onChange?: (value: string) => void; [key: string]: unknown }) =>
    element('input', { ...props, type: 'number', value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) })

  return { Button, Input, InputNumber, Switch }
})

function fixture(key: string, value: string, label: string, group = 'general', valueType: SettingView['valueType'] = 'string'): SettingView {
  return {
    key,
    value,
    valueType,
    group,
    label,
    description: `${label}说明`,
    isSecret: false,
    persisted: false,
    configured: false,
  }
}

const fixtureSettings: SettingView[] = [
  fixture('general.siteUrl', 'https://example.com', '站点 URL'),
  fixture('general.siteName', '灵动创影', '站点名称'),
  fixture('general.siteSubtitle', 'AI 创作平台', '站点副标题'),
  fixture('general.siteLogo', '', '站点 Logo'),
  fixture('general.supportEmail', 'support@example.com', '客服邮箱'),
  fixture('general.contactInfo', '在线客服', '客服联系方式'),
  fixture('general.docUrl', 'https://docs.example.com', '文档链接'),
  fixture('general.homeContent', '<p>首页</p>', '首页内容'),
  fixture('general.compactHomeEnabled', 'true', '简洁首页', 'customization', 'boolean'),
  fixture('general.hideCcsImportButton', 'false', '隐藏 CCS 导入按钮', 'customization', 'boolean'),
  fixture('general.customMenuItems', '[{"id":"docs","label":"文档","url":"https://docs.example.com","visibility":"user","enabled":true,"sortOrder":1}]', '自定义菜单页面', 'customization'),
  fixture('table.defaultPageSize', '20', '默认每页条数', 'table', 'number'),
  fixture('table.pageSizeOptions', '10,20,50', '可选每页条数列表', 'table'),
]

async function renderPanel(): Promise<{ container: HTMLDivElement; root: Root; onDraftChange: ReturnType<typeof vi.fn> }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onDraftChange = vi.fn()
  await act(async () => {
    root.render(
      <GeneralSettingsPanel
        settings={fixtureSettings}
        drafts={Object.fromEntries(fixtureSettings.map((setting) => [setting.key, setting.value]))}
        onDraftChange={onDraftChange}
        onBatchSave={vi.fn()}
        saving={false}
        saved={false}
      />,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { container, root, onDraftChange }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('GeneralSettingsPanel', () => {
  it('renders general settings as business sections with structured editors', async () => {
    const { container, root } = await renderPanel()

    expect(container.textContent).toContain('站点 URL')
    expect(container.textContent).toContain('站点名称')
    expect(container.textContent).toContain('客服邮箱')
    expect(container.textContent).toContain('文档链接')
    expect(container.textContent).toContain('首页内容')
    expect(container.textContent).toContain('iframe')
    expect(container.textContent).toContain('通用表格设置')
    expect(container.querySelector('[data-testid="logo-uploader"] input[type="file"]')?.getAttribute('accept')).toContain('image/png')
    expect(container.querySelector('[data-testid="custom-menu-editor"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="custom-menu-json"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('serializes a newly added menu item through the draft callback', async () => {
    const { container, root, onDraftChange } = await renderPanel()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="custom-menu-add"]')?.click()
    })

    expect(onDraftChange).toHaveBeenCalledWith('general.customMenuItems', expect.stringContaining('"enabled":true'))
    expect(onDraftChange).toHaveBeenCalledWith('general.customMenuItems', expect.stringContaining('"visibility":"user"'))

    await act(async () => root.unmount())
  })
})
