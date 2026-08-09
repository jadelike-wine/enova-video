import { formatErrorMessage } from './errorMessage'

export interface RefreshableTask {
  _optimistic?: boolean
  status?: string
  error_message?: unknown
  video_id?: unknown
  request_params?: unknown
}

export function isTransientError(raw: unknown): boolean {
  const text = formatErrorMessage(raw).toLowerCase()
  if (!text) return false
  return [
    '429',
    'too many requests',
    '503',
    '502',
    '504',
    'timeout',
    'timed out',
    'connection reset',
    'temporarily unavailable',
  ].some((marker) => text.includes(marker))
}

export function canRefreshTaskStatus(task: RefreshableTask | null, kind: 'image' | 'video'): boolean {
  if (!task || task._optimistic || task.status === 'completed') return false

  const transient = isTransientError(task.error_message)
  if (kind === 'video') {
    if (!task.video_id) return false
    return transient || task.status === 'failed'
  }
  if (kind === 'image') {
    if (!task.request_params) return false
    return transient
  }
  return false
}