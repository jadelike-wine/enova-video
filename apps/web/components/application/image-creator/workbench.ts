import { DEFAULT_IMAGE_MODEL } from '../../../lib/models'
import type { ImageFormValues, ImageTask } from './types'

export function conversationTitle(task: ImageTask | null, fallback: string, maxLength = 36): string {
  const firstLine = task?.prompt?.trim().split(/\r?\n/, 1)[0]?.trim()
  if (!firstLine) return fallback
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1).trimEnd()}…` : firstLine
}

export function taskMetadata(task: ImageTask | null): string[] {
  if (!task) return []
  return [task.model, task.ratio, task.size].filter((value): value is string => Boolean(value))
}

export function formValuesFromTask(task: ImageTask): ImageFormValues {
  return {
    model: task.model || DEFAULT_IMAGE_MODEL,
    mode: task.mode || 'text2img',
    prompt: task.prompt || '',
    size: task.size || '1K',
    ratio: task.ratio || '1:1',
  }
}

export function workspaceShellMode(pathname: string): 'admin' | 'creator' {
  return pathname === '/app/admin' || pathname.startsWith('/app/admin/') ? 'admin' : 'creator'
}
