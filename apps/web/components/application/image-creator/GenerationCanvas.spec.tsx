/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GenerationCanvas from './GenerationCanvas'
import type { ImageTask } from './types'

;(globalThis as typeof globalThis & { React: typeof React }).React = React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./ImageGrid', () => ({
  default: ({ tasks }: { tasks: ImageTask[] }) => (
    <div data-testid="image-grid">
      {tasks.map((task) => (
        <span key={task.id}>{task.output_url}</span>
      ))}
    </div>
  ),
}))

const task: ImageTask = {
  id: 'generation-1',
  status: 'SUCCEEDED',
  prompt: '霓虹雨夜里的未来街景',
  model: 'agnes-image-2.1-flash',
  ratio: '16:9',
  size: '1K',
  output_url: 'https://cdn.example.com/future-city.png',
  created_at: '2026-08-26T10:30:00.000Z',
}

let root: Root | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  document.body.innerHTML = ''
})

async function renderCanvas(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(element)
  })
  return container
}

describe('GenerationCanvas', () => {
  it('renders the empty state', async () => {
    const container = await renderCanvas(<GenerationCanvas state="empty" />)

    expect(container.textContent).toContain('输入描述开始创作')
    expect(container.textContent).toContain('把你的想法写下来，生成第一张图片。')
  })

  it('renders generation progress with the prompt bubble', async () => {
    const container = await renderCanvas(
      <GenerationCanvas state="generating" task={{ ...task, status: 'RUNNING' }} progress={42} />,
    )

    expect(container.textContent).toContain('霓虹雨夜里的未来街景')
    expect(container.textContent).toContain('正在生成 42%')
  })

  it('renders success metadata and action callbacks', async () => {
    const onEdit = vi.fn()
    const onRegenerate = vi.fn()
    const onDownload = vi.fn()
    const onCopyPrompt = vi.fn()
    const onFavorite = vi.fn()
    const onDelete = vi.fn()
    const container = await renderCanvas(
      <GenerationCanvas
        state="success"
        task={task}
        onEdit={onEdit}
        onRegenerate={onRegenerate}
        onDownload={onDownload}
        onCopyPrompt={onCopyPrompt}
        onFavorite={onFavorite}
        onDelete={onDelete}
      />,
    )

    expect(container.querySelector('[data-testid="image-grid"]')).not.toBeNull()
    expect(container.textContent).toContain('Agnes Image 2.1 Flash')
    expect(container.textContent).toContain('16:9')
    expect(container.textContent).toContain('1K')
    expect(container.textContent).toContain('1312x736')
    expect(container.textContent).toContain('生成时间')

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '重新编辑')?.click()
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '再次生成')?.click()
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '下载')?.click()
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '复制提示词')?.click()
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '收藏')?.click()
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '删除')?.click()
    })

    expect(onEdit).toHaveBeenCalledWith(task)
    expect(onRegenerate).toHaveBeenCalledWith(task)
    expect(onDownload).toHaveBeenCalledWith(task)
    expect(onCopyPrompt).toHaveBeenCalledWith(task.prompt)
    expect(onFavorite).toHaveBeenCalledWith(task, true)
    expect(onDelete).toHaveBeenCalledWith(task)
  })

  it('renders the error state and retry action', async () => {
    const onRegenerate = vi.fn()
    const container = await renderCanvas(
      <GenerationCanvas state="error" task={task} errorMessage="Provider timeout" onRegenerate={onRegenerate} />,
    )

    expect(container.getAttribute('role')).toBeNull()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).toContain('生成失败')
    expect(container.textContent).toContain('Provider timeout')

    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(onRegenerate).toHaveBeenCalledWith(task)
  })
})
