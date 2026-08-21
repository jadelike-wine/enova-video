import { describe, expect, it } from 'vitest'
import { conversationTitle, taskMetadata, workspaceShellMode } from './workbench'
import type { ImageTask } from './types'

const task = (overrides: Partial<ImageTask> = {}): ImageTask => ({
  id: 'generation-1',
  status: 'SUCCEEDED',
  prompt: 'A luminous floating city above a misty canyon\nwith cinematic light',
  model: 'agnes-image-2.1-flash',
  ratio: '1:1',
  size: '1K',
  created_at: '2026-08-21T08:30:00.000Z',
  ...overrides,
})

describe('image workbench projections', () => {
  it('uses the first prompt line as a compact conversation title', () => {
    expect(conversationTitle(task(), 'Untitled creation', 32)).toBe('A luminous floating city above…')
  })

  it('uses a fallback title when the prompt is blank', () => {
    expect(conversationTitle(task({ prompt: '  ' }), 'Untitled creation')).toBe('Untitled creation')
  })

  it('returns only available metadata values', () => {
    expect(taskMetadata(task({ size: undefined }))).toEqual(['agnes-image-2.1-flash', '1:1'])
  })

  it('separates admin routes from creator routes', () => {
    expect(workspaceShellMode('/app/admin/settings')).toBe('admin')
    expect(workspaceShellMode('/app/images')).toBe('creator')
  })
})
