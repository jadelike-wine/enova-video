/**
 * Enova Creator API 客户端（新架构）。
 *
 * 后端为 NestJS（apps/api），路由前缀 /api/v1，通过 Next rewrite 同源代理。
 * 鉴权基于 HttpOnly Session Cookie（enova_session），fetch 采用同源默认 credentials。
 * 所有解析出的错误统一为 { error: { code, message, requestId } } 形态。
 */

const BASE = '/api/v1'

// ---------------------------------------------------------------------------
// 类型（与 apps/api 契约保持一致）
// ---------------------------------------------------------------------------

export interface AuthUser {
  userId: string
  email: string
  role: string
  status: string
  workspaceId: string
  workspaceRole: string
}

export interface AuthResult {
  user: AuthUser
  balance: number
  reservedBalance: number
}

export interface TurnstileConfig {
  enabled: boolean
  siteKey: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface Message {
  id: string
  conversationId: string
  role: string
  content: string
  provider?: string | null
  model?: string | null
  inputTokens: number
  outputTokens: number
  createdAt: string
}

export type GenerationType = 'IMAGE' | 'VIDEO'
export type GenerationStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'

export interface Generation {
  id: string
  type: string
  status: string
  provider?: string | null
  model?: string | null
  input?: Record<string, unknown> | null
  output?: {
    url?: string | null
    width?: number | null
    height?: number | null
    duration?: number | null
    mimeType?: string | null
    storageProvider?: string | null
  } | null
  errorCode?: string | null
  errorMessage?: string | null
  estimatedCredits: number
  reservedCredits: number
  actualCredits: number
  createdAt: string
  completedAt?: string | null
}

export interface Wallet {
  balance: number
  reservedBalance: number
}

export interface LedgerEntry {
  id: string
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  reservedBefore: number
  reservedAfter: number
  description?: string | null
  createdAt: string
}

export interface RechargeResult {
  orderId: string
  provider: string
  amountCents: number
  credits: number
  payUrl?: string | null
  qrCode?: string | null
}

// ---------------------------------------------------------------------------
// 底层请求
// ---------------------------------------------------------------------------

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function addRequestIdHeader(headers: RequestInit['headers'] = undefined): Headers {
  const h = new Headers(headers || {})
  if (!h.has('X-Request-ID')) h.set('X-Request-ID', newRequestId())
  return h
}

export class ApiError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly status: number
  constructor(status: number, body: unknown, fallback: string) {
    const b = (body ?? {}) as {
      error?: { code?: string; message?: string; requestId?: string }
    }
    const msg = b.error?.message ?? (status >= 500 ? '服务器内部错误' : fallback)
    super(msg)
    this.name = 'ApiError'
    this.status = status
    this.code = b.error?.code ?? 'UNKNOWN'
    this.requestId = b.error?.requestId
  }
}

async function request(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = addRequestIdHeader(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const resp = await fetch(`${BASE}${url}`, { ...options, headers })
  if (!resp.ok) {
    const body = await resp.json().catch(() => undefined)
    throw new ApiError(resp.status, body, resp.statusText)
  }
  return resp
}

async function json<T>(url: string, options: RequestInit = {}): Promise<T> {
  return (await request(url, options)).json() as Promise<T>
}

// ---------------------------------------------------------------------------
// 鉴权
// ---------------------------------------------------------------------------

export const authApi = {
  register: (email: string, password: string, turnstileToken?: string) =>
    json<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, turnstileToken }) }),
  login: (email: string, password: string, turnstileToken?: string) =>
    json<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, turnstileToken }) }),
  logout: () => json<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => json<AuthResult>('/auth/me'),
}

export const turnstileApi = {
  config: () => json<TurnstileConfig>('/auth/turnstile-config'),
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

export const conversationApi = {
  list: (limit = 50) => json<Conversation[]>(`/conversations?limit=${limit}`),
  create: (title?: string) =>
    json<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ title }) }),
  get: (id: string) => json<Conversation>(`/conversations/${id}`),
  rename: (id: string, title: string) =>
    json<Conversation>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  remove: (id: string) => json<{ ok: true }>(`/conversations/${id}`, { method: 'DELETE' }),
  listMessages: (id: string) => json<Message[]>(`/conversations/${id}/messages`),
  appendMessages: (id: string, messages: { role: string; content: string; provider?: string; model?: string }[]) =>
    json<Message[]>(`/conversations/${id}/messages/batch`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),
}

// ---------------------------------------------------------------------------
// 生成任务（图片/视频统一）
// ---------------------------------------------------------------------------

export interface CreateGenerationPayload {
  type: GenerationType
  provider: string
  model: string
  input?: Record<string, unknown>
}

export const generationApi = {
  create: (payload: CreateGenerationPayload) =>
    json<Generation>('/generations', { method: 'POST', body: JSON.stringify(payload) }),
  list: (limit = 50) => json<Generation[]>(`/generations?limit=${limit}`),
  get: (id: string) => json<Generation>(`/generations/${id}`),
  cancel: (id: string) => json<Generation>(`/generations/${id}/cancel`, { method: 'POST' }),
}

// ---------------------------------------------------------------------------
// 计费 / 钱包 / 充值
// ---------------------------------------------------------------------------

export const billingApi = {
  wallet: () => json<Wallet>('/billing/wallet'),
  ledger: (limit = 50) => json<LedgerEntry[]>(`/billing/ledger?limit=${limit}`),
}

export const paymentApi = {
  recharge: (amountCents: number) =>
    json<RechargeResult>('/payment/recharge', { method: 'POST', body: JSON.stringify({ amountCents }) }),
  sandboxConfirm: (orderId: string) =>
    json<{ orderId: string; credits: number; balance: number }>(`/payment/sandbox/${orderId}/confirm`, {
      method: 'POST',
    }),
}

// ---------------------------------------------------------------------------
// 系统配置（管理员）
// ---------------------------------------------------------------------------

export interface SettingView {
  key: string
  value: string
  valueType: 'string' | 'number' | 'boolean' | 'enum'
  group: string
  label: string
  description?: string
  isSecret: boolean
  options?: string[]
  persisted: boolean
}

export const settingsApi = {
  list: () => json<SettingView[]>('/admin/settings'),
  update: (key: string, value: string) =>
    json<SettingView>(`/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    }),
}

// ---------------------------------------------------------------------------
// 系统更新（管理员）
// ---------------------------------------------------------------------------

export interface SystemUpdateInfo {
  enabled: boolean
  current_version: string
  latest_version: string
  has_update: boolean
  cached: boolean
  warning?: string
  release_info?: {
    name: string
    body: string
    published_at: string
    html_url: string
  }
}

export interface RollbackVersion {
  version: string
  published_at: string
  html_url: string
}

export interface SystemUpdateOperation {
  operation_id: string
  status: 'running' | 'success' | 'failed'
  action: 'update' | 'rollback'
  target?: string
  output?: string
  exit_code?: number
  started_at?: string
  finished_at?: string
}

function idempotencyKey(): string {
  return newRequestId()
}

export const systemUpdateApi = {
  status: (force = false) => json<SystemUpdateInfo>(`/admin/system-update/status?force=${force}`),
  check: () => json<SystemUpdateInfo>('/admin/system-update/check'),
  rollbackVersions: () => json<{ versions: RollbackVersion[] }>('/admin/system-update/rollback-versions'),
  update: (version?: string) =>
    json<SystemUpdateOperation>('/admin/system-update/update', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify(version ? { version } : {}),
    }),
  rollback: (version?: string) =>
    json<SystemUpdateOperation>('/admin/system-update/rollback', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify(version ? { version } : {}),
    }),
  operation: (id: string) => json<SystemUpdateOperation>(`/admin/system-update/operations/${encodeURIComponent(id)}`),
}

// ---------------------------------------------------------------------------
// 模型目录 / 上传
// ---------------------------------------------------------------------------

export const modelsApi = {
  get: () => Promise.reject(new ApiError(404, { error: { code: 'NOT_FOUND', message: '模型目录由前端本地提供' } }, '模型目录不可用')),
}

export const uploadApi = {
  upload: async (file: File): Promise<{ url: string }> => {
    const form = new FormData()
    form.append('file', file)
    const headers = addRequestIdHeader()
    // 注意：不要手动设置 Content-Type，浏览器会带 boundary。
    const resp = await fetch(`${BASE}/uploads`, { method: 'POST', headers, body: form })
    if (!resp.ok) {
      const body = await resp.json().catch(() => undefined)
      throw new ApiError(resp.status, body, '上传失败')
    }
    return (await resp.json()) as { url: string }
  },
}

// ---------------------------------------------------------------------------
// 对话流式生成（SSE）
// ---------------------------------------------------------------------------

export type StreamChunkHandler = (content: string) => void
export type StreamDoneHandler = (parsed: Record<string, unknown>) => void
export type StreamErrorHandler = (message: string) => void

export interface ChatPayload {
  content: string
  model?: string
  provider?: string
  [k: string]: unknown
}

export function sendMessageStream(
  conversationId: string,
  data: ChatPayload,
  onChunk: StreamChunkHandler,
  onDone: StreamDoneHandler,
  onError: StreamErrorHandler,
): void {
  fetch(`${BASE}/conversations/${conversationId}/messages/stream`, {
    method: 'POST',
    headers: addRequestIdHeader({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const err = await resp.json().catch(() => undefined)
        onError((err as { error?: { message?: string } })?.error?.message || '请求失败')
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

export default {
  authApi,
  conversationApi,
  generationApi,
  billingApi,
  paymentApi,
  sendMessageStream,
}
