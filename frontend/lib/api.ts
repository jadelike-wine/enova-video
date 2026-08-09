/**
 * API client. All requests go to `/api/*`, which Next.js rewrites to FastAPI.
 * The browser only ever sees `/api/*`.
 */

const BASE = '/api'

export type ApiError = Error

async function request(url: string, options: RequestInit = {}): Promise<Response> {
  const resp = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error((err as { detail?: string }).detail || resp.statusText)
  }
  return resp
}

async function json<T>(url: string, options: RequestInit = {}): Promise<T> {
  return (await request(url, options)).json() as Promise<T>
}

type ChunkHandler = (chunk: string) => void
type DoneHandler = (parsed: Record<string, unknown>) => void
type ErrorHandler = (message: string) => void

function postStream(
  url: string,
  data: Record<string, unknown>,
  onChunk: ChunkHandler,
  onDone: DoneHandler,
  onError: ErrorHandler,
): void {
  fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, stream: true }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        onError((err as { detail?: string }).detail || '请求失败')
        return
      }
      const reader = resp.body?.getReader()
      if (!reader) {
        onError('响应流不可用')
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return
        try {
          const parsed = JSON.parse(line.slice(6))
          if (parsed.type === 'content') onChunk(parsed.content)
          else if (parsed.type === 'done') {
            finished = true
            onDone(parsed)
          } else if (parsed.type === 'error') {
            finished = true
            onError(parsed.message || '请求失败')
          }
        } catch {
          /* ignore malformed lines */
        }
      }

      const read = async (): Promise<void> => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) processLine(line)
        }
        buffer += decoder.decode()
        for (const line of buffer.split('\n')) processLine(line)
        if (!finished) onError('模型未返回完整响应，请检查后端服务或网络连接')
      }

      read().catch(onError)
    })
    .catch(onError)
}

export const chatApi = {
  listConversations: () => json<unknown[]>('/chat/conversations'),
  createConversation: (data: Record<string, unknown>) =>
    json('/chat/conversations', { method: 'POST', body: JSON.stringify(data) }),
  getConversation: (id: number) => json(`/chat/conversations/${id}`),
  deleteConversation: (id: number) =>
    json(`/chat/conversations/${id}`, { method: 'DELETE' }),
  updateConversation: (id: number, data: Record<string, unknown>) =>
    json(`/chat/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getModels: () => json<{ models: { id: string; name: string; deprecated: boolean }[] }>('/chat/models'),
  deleteMessage: (convId: number, msgId: number) =>
    json(`/chat/conversations/${convId}/messages/${msgId}`, { method: 'DELETE' }),

  sendMessageStream(
    convId: number,
    data: Record<string, unknown>,
    onChunk: ChunkHandler,
    onDone: DoneHandler,
    onError: ErrorHandler,
  ) {
    postStream(`/chat/conversations/${convId}/send`, data, onChunk, onDone, onError)
  },

  regenerateStream(
    convId: number,
    msgId: number,
    data: Record<string, unknown>,
    onChunk: ChunkHandler,
    onDone: DoneHandler,
    onError: ErrorHandler,
  ) {
    postStream(
      `/chat/conversations/${convId}/messages/${msgId}/regenerate`,
      data,
      onChunk,
      onDone,
      onError,
    )
  },
}

export const imageApi = {
  getModels: () => json<{ models: { id: string; name: string }[]; sizes: string[] }>('/images/models'),
  generate: (data: Record<string, unknown>, files?: File[]) => {
    if (files?.length) {
      const form = new FormData()
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null) form.append(k, String(v))
      }
      for (const file of files) form.append('files', file)
      return fetch(`${BASE}/images/generate`, { method: 'POST', body: form }).then(
        async (resp) => {
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: resp.statusText }))
            throw new Error((err as { detail?: string }).detail || resp.statusText)
          }
          return resp.json()
        },
      )
    }
    return json('/images/generate', { method: 'POST', body: JSON.stringify(data) })
  },
  listTasks: ({ limit = 20, offset = 0 } = {}) =>
    json(`/images/tasks?limit=${limit}&offset=${offset}`),
  getTask: (id: number) => json(`/images/tasks/${id}`),
  syncTask: (id: number) => json(`/images/tasks/${id}/sync`, { method: 'POST' }),
  deleteTask: (id: number) => json(`/images/tasks/${id}`, { method: 'DELETE' }),
}

export const videoApi = {
  getModels: () =>
    json<{
      models: { id: string; name: string }[]
      modes: { id: string; name: string }[]
      frame_presets: { label: string; num_frames: number; frame_rate: number }[]
      resolution_presets: {
        id: string
        group: string
        label: string
        width: number
        height: number
      }[]
    }>('/videos/models'),
  generate: (data: Record<string, unknown>) =>
    json('/videos/generate', { method: 'POST', body: JSON.stringify(data) }),
  getTask: (id: number) => json(`/videos/tasks/${id}`),
  syncTask: (id: number) => json(`/videos/tasks/${id}/sync`, { method: 'POST' }),
  retry: (id: number) => json(`/videos/tasks/${id}/retry`, { method: 'POST' }),
  deleteTask: (id: number) => json(`/videos/tasks/${id}`, { method: 'DELETE' }),
  listTasks: ({ limit = 20, offset = 0 } = {}) =>
    json(`/videos/tasks?limit=${limit}&offset=${offset}`),
  upload: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const resp = await fetch(`${BASE}/videos/upload`, { method: 'POST', body: form })
    if (!resp.ok) throw new Error('上传失败')
    return resp.json()
  },
}

export const settingsApi = {
  getStatus: () => json('/settings/status'),
  getBaseUrl: () => json('/settings/base-url'),
  updateBaseUrl: (base_url: string) =>
    json('/settings/base-url', { method: 'PUT', body: JSON.stringify({ base_url }) }),
  listApiKeys: () => json<{ items: unknown[] }>('/settings/api-keys'),
  createApiKey: (data: Record<string, unknown>) =>
    json('/settings/api-keys', { method: 'POST', body: JSON.stringify(data) }),
  updateApiKey: (id: number, data: Record<string, unknown>) =>
    json(`/settings/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  activateApiKey: (id: number) =>
    json(`/settings/api-keys/${id}/activate`, { method: 'POST' }),
  deleteApiKey: (id: number) =>
    json(`/settings/api-keys/${id}`, { method: 'DELETE' }),
}