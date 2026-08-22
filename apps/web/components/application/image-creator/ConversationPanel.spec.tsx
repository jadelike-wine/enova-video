/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConversationPanel from './ConversationPanel'
import type { ImageTask } from './types'

;(globalThis as typeof globalThis & { React: typeof React }).React = React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    'workbench.conversation': '创作列表',
    'workbench.newConversation': '新对话',
    'workbench.defaultCreation': '默认创作',
    'workbench.recent': '最近',
    'workbench.empty': '还没有生成记录',
    'workbench.closeConversation': '关闭创作列表',
    'workbench.createdAt': '生成于',
    'workbench.promptFallback': '未命名创作',
  }[key] ?? key),
}))

const task: ImageTask = {
  id: 'generation-1',
  status: 'SUCCEEDED',
  prompt: '浮空城市海报',
  title: '浮空城市海报',
  output_url: 'https://cdn.example.com/city.png',
}

let root: Root | null = null
afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  document.body.innerHTML = ''
})

describe('ConversationPanel', () => {
  it('renders new/default/recent creation actions and selected state', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <ConversationPanel
          open
          tasks={[task]}
          selectedTaskId={task.id}
          onClose={vi.fn()}
          onNewConversation={vi.fn()}
          onSelectTask={vi.fn()}
        />,
      )
    })

    expect(container.querySelector('[aria-label="创作列表"]')).not.toBeNull()
    expect(container.textContent).toContain('新对话')
    expect(container.textContent).toContain('默认创作')
    expect(container.textContent).toContain('浮空城市海报')
    expect(container.querySelector('[aria-current="true"]')).not.toBeNull()
  })
})
