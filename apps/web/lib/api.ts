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

export interface LoginAgreementDocument {
  slug: string
  title: string
}

export interface LoginAgreementConfig {
  enabled: boolean
  mode: 'modal' | 'checkbox'
  updatedAt: string
  revision: string
  documents: LoginAgreementDocument[]
}

export interface LegalDocument extends LoginAgreementDocument {
  contentMd: string
}

export interface TurnstileConfig {
  enabled: boolean
  siteKey: string
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
    progress?: number | null
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

export interface OrderStatus {
  orderId: string
  status: string
  amountCents: number
  credits: number
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
  readonly details?: unknown
  constructor(status: number, body: unknown, fallback: string) {
    const b = (body ?? {}) as {
      error?: { code?: string; message?: string; requestId?: string; details?: unknown }
    }
    const msg = b.error?.message ?? (status >= 500 ? '服务器内部错误' : fallback)
    super(msg)
    this.name = 'ApiError'
    this.status = status
    this.code = b.error?.code ?? 'UNKNOWN'
    this.requestId = b.error?.requestId
    this.details = b.error?.details
  }
}

/**
 * 检测 API 错误是否为 step-up 密码二次验证要求。
 *
 * 后端对安全敏感操作（如修改 SSRF 配置）返回 403 + details.stepUpRequired=true。
 * 前端据此弹出管理员密码验证框，输入后带 x-step-up-password header 重试。
 */
export function isStepUpRequired(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  const details = err.details as { stepUpRequired?: boolean; method?: string } | undefined
  return err.code === 'FORBIDDEN' && Boolean(details?.stepUpRequired)
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
  register: (email: string, password: string, turnstileToken?: string, agreementRevision?: string, invitationCode?: string, promoCode?: string) =>
    json<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, turnstileToken, agreementRevision, invitationCode, promoCode }),
    }),
  login: (email: string, password: string, turnstileToken?: string, agreementRevision?: string) =>
    json<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, turnstileToken, agreementRevision }),
    }),
  logout: () => json<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => json<AuthResult>('/auth/me'),
  forgotPassword: (email: string) =>
    json<{ ok: true }>('/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    json<{ ok: true }>('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
  verifyEmail: (token: string) =>
    json<{ ok: true }>('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
}

/** 自定义菜单项。 */
export interface CustomMenuItem {
  id: string
  label: string
  url: string
  visibility: 'user' | 'admin'
  sortOrder: number
  /** Stored setting values may include this flag; public API filters disabled items. */
  enabled?: boolean
}

export interface SiteConfig {
  siteUrl: string
  supportEmail: string
  siteName: string
  siteSubtitle: string
  siteLogo: string
  contactInfo: string
  docUrl: string
  homeContent: string
  compactHomeEnabled: boolean
  hideCcsImportButton: boolean
  customMenuItems: CustomMenuItem[]
  tableDefaultPageSize: number
  tablePageSizeOptions: number[]
}

export interface AuthConfig {
  openRegistration: boolean
  emailVerification: boolean
  emailDomainWhitelist: string[]
  nonWhitelistDomainLimit: boolean
  enablePromoCode: boolean
  requireInvitationCode: boolean
  enablePasswordReset: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
}

export const publicApi = {
  loginAgreement: () => json<LoginAgreementConfig>('/public/login-agreement'),
  legalDocument: (slug: string) => json<LegalDocument>(`/public/legal/${encodeURIComponent(slug)}`),
  siteConfig: () => json<SiteConfig>('/public/site-config'),
  authConfig: () => json<AuthConfig>('/public/auth-config'),
}

export const turnstileApi = {
  config: () => json<TurnstileConfig>('/auth/turnstile-config'),
}

// ---------------------------------------------------------------------------
// 首启 Setup（管理员初始化）
// ---------------------------------------------------------------------------

export interface SetupStatus {
  needsSetup: boolean
}

export const setupApi = {
  status: () => json<SetupStatus>('/setup/status'),
  init: (email: string, password: string) =>
    json<AuthResult>('/setup/init', { method: 'POST', body: JSON.stringify({ email, password }) }),
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

export type AssetType = 'IMAGE' | 'VIDEO' | 'UPLOAD'
export type AssetListType = 'ALL' | 'IMAGE' | 'VIDEO'
export type AssetSort = 'NEWEST' | 'OLDEST'

export interface Asset {
  id: string
  type: AssetType
  url: string | null
  mimeType: string | null
  size: number
  width: number | null
  height: number | null
  duration: number | null
  createdAt: string
  generationId: string | null
  prompt: string | null
}

export interface ListAssetsParams {
  type?: AssetListType
  from?: string
  to?: string
  sort?: AssetSort
  limit?: number
}

export const assetsApi = {
  list: (params: ListAssetsParams = {}) => {
    const query = new URLSearchParams()
    if (params.type && params.type !== 'ALL') query.set('type', params.type)
    if (params.from) query.set('from', params.from)
    if (params.to) query.set('to', params.to)
    if (params.sort && params.sort !== 'NEWEST') query.set('sort', params.sort)
    if (params.limit !== undefined && params.limit !== 60) query.set('limit', String(params.limit))

    const search = query.toString()
    return json<Asset[]>(`/assets${search ? `?${search}` : ''}`)
  },
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
  // P2: 查询订单支付状态（前端 return 页轮询用）
  getOrderStatus: (orderId: string) =>
    json<OrderStatus>(`/payment/orders/${encodeURIComponent(orderId)}`),
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
  restartRequired?: boolean
  permission?: string
  min?: number
  max?: number
  configured?: boolean
}

export interface SettingHistoryEntry {
  id: string
  key: string
  version: number
  before?: string | null
  after?: string | null
  reason?: string | null
  updatedBy?: string | null
  requestId?: string | null
  createdAt: string
}

export interface StorageTestResult {
  provider: string
  bucket: string
  key: string
  exists: boolean
  publicUrl: string
  publicUrlAccessible: boolean
}

export const settingsApi = {
  list: () => json<SettingView[]>('/admin/settings'),
  update: (key: string, value: string, expectedVersion?: number, stepUpPassword?: string) =>
    json<SettingView>(`/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ value, expectedVersion }),
      headers: stepUpPassword ? { 'x-step-up-password': stepUpPassword } : undefined,
    }),
  batchUpdate: (items: Array<{ key: string; value: string }>, stepUpPassword?: string) =>
    json<SettingView[]>('/admin/settings/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
      headers: stepUpPassword ? { 'x-step-up-password': stepUpPassword } : undefined,
    }),
  clearSecret: (key: string, stepUpPassword?: string) =>
    json<SettingView>(`/admin/settings/${encodeURIComponent(key)}/secret`, {
      method: 'DELETE',
      headers: stepUpPassword ? { 'x-step-up-password': stepUpPassword } : undefined,
    }),
  history: (key: string, limit?: number) =>
    json<SettingHistoryEntry[]>(`/admin/settings/${encodeURIComponent(key)}/history${limit ? `?limit=${limit}` : ''}`),
  testStorage: () => json<StorageTestResult>('/admin/settings/storage/test', { method: 'POST' }),
}

// ---------------------------------------------------------------------------
// 邮件模板（管理员）
// ---------------------------------------------------------------------------

export interface EmailEventMeta {
  event: string
  label: string
  category: string
  description: string
  optional: boolean
  placeholders: string[]
}

export interface EmailTemplateListResponse {
  events: EmailEventMeta[]
  locales: string[]
  placeholders: string[]
}

export interface EmailTemplateDetail {
  event: string
  locale: string
  subject: string
  html: string
  isCustom: boolean
  updatedAt?: string
  placeholders: string[]
}

export interface EmailTemplatePreview {
  subject: string
  html: string
}

export const emailApi = {
  // 测试 SMTP 连接（不发送邮件）
  testSmtpConnection: (config?: { host?: string; port?: number; secure?: boolean; user?: string; password?: string }) =>
    json<{ ok: true; message: string }>('/admin/email/test-smtp', {
      method: 'POST',
      body: JSON.stringify(config ?? {}),
    }),
  // 测试邮件
  sendTestEmail: (to: string, subject?: string) =>
    json<{ ok: true; message: string }>('/admin/email/test', {
      method: 'POST',
      body: JSON.stringify({ to, subject }),
    }),
  checkConfig: () =>
    json<{ configured: boolean; sender: string }>('/admin/email/check', { method: 'POST' }),
  // 邮件模板
  getTemplateList: () =>
    json<EmailTemplateListResponse>('/admin/settings/email-templates'),
  getTemplate: (event: string, locale: string) =>
    json<EmailTemplateDetail>(`/admin/settings/email-templates/${encodeURIComponent(event)}/${encodeURIComponent(locale)}`),
  updateTemplate: (event: string, locale: string, data: { subject: string; html: string }) =>
    json<EmailTemplateDetail>(`/admin/settings/email-templates/${encodeURIComponent(event)}/${encodeURIComponent(locale)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  restoreOfficial: (event: string, locale: string) =>
    json<EmailTemplateDetail>(`/admin/settings/email-templates/${encodeURIComponent(event)}/${encodeURIComponent(locale)}/restore-official`, {
      method: 'POST',
    }),
  previewTemplate: (data: { event: string; locale: string; subject: string; html: string }) =>
    json<EmailTemplatePreview>('/admin/settings/email-templates/preview', {
      method: 'POST',
      body: JSON.stringify(data),
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

export interface UploadResult {
  url: string
}

export const uploadApi = {
  upload: async (file: File): Promise<UploadResult> => {
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

const api = {
  authApi,
  generationApi,
  assetsApi,
  billingApi,
  paymentApi,
}

export default api
