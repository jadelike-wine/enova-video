/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GenerationWorkspaceChrome from './GenerationWorkspaceChrome'

;(globalThis as typeof globalThis & { React: typeof React }).React = React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  document.body.innerHTML = ''
})

async function renderChrome() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onNewConversation = vi.fn()
  const onSelectTask = vi.fn()
  await act(async () => {
    root?.render(
      <GenerationWorkspaceChrome
        mode="image"
        tasks={[{ id: 'task-1', title: '城市海报', status: 'SUCCEEDED' }]}
        selectedTaskId={null}
        onNewConversation={onNewConversation}
        onSelectTask={onSelectTask}
      />,
    )
  })
  return { container, onNewConversation, onSelectTask }
}

describe('GenerationWorkspaceChrome', () => {
  it('closes the history panel after selecting a task', async () => {
    const { container, onSelectTask } = await renderChrome()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.generation-expand-button')?.click()
    })
    expect(container.querySelector('[aria-label="历史对话"]')).not.toBeNull()

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('城市海报'))?.click()
    })

    expect(onSelectTask).toHaveBeenCalledWith('task-1')
    expect(container.querySelector('[aria-label="历史对话"]')).toBeNull()
  })

  it('closes the history panel after starting a new conversation', async () => {
    const { container, onNewConversation } = await renderChrome()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.generation-expand-button')?.click()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.generation-history-new')?.click()
    })

    expect(onNewConversation).toHaveBeenCalled()
    expect(container.querySelector('[aria-label="历史对话"]')).toBeNull()
  })
})
