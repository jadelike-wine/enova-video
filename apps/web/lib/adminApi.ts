/**
 * Admin 运营控制台 API 客户端（只访问 /api/v1/admin/*）。
 *
 * 鉴权基于 HttpOnly Session Cookie，与 lib/api.ts 同源同 cookie。
 * 所有写操作（adjustCredits / setStatus / forceFail / replay / retryFulfillment）
 * 后端均已落 admin_audit_logs（含 before/after），前端仅触发调用，不做二次确认。
 */

const BASE = '/api/v1/admin'

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

export class AdminApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(status: number, body: unknown, fallback: string) {
    const b = (body ?? {}) as { error?: { code?: string; message?: string } }
    super(b.error?.message ?? fallback)
    this.name = 'AdminApiError'
    this.status = status
    this.code = b.error?.code ?? 'UNKNOWN'
  }
}

async function json<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!headers.has('X-Request-ID')) headers.set('X-Request-ID', newRequestId())
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const resp = await fetch(`${BASE}${url}`, { ...options, headers })
  if (!resp.ok) {
    const body = await resp.json().catch(() => undefined)
    throw new AdminApiError(resp.status, body, resp.statusText)
  }
  return (await resp.json()) as Promise<T>
}

// ---------------------------------------------------------------------------
// 类型（与 apps/api 各 Admin Service View 对齐）
// ---------------------------------------------------------------------------

export interface AdminUserView {
  id: string
  email: string
  role: string
  status: string
  workspaceId: string | null
  workspaceRole: string | null
  balance: number
  reservedBalance: number
  createdAt: string
}

export interface AdminOrderView {
  id: string
  workspaceId: string
  userId: string
  orderType: string
  amountCents: number
  currency: string
  credits: number
  planId: string | null
  status: string
  fulfillmentStatus: string
  createdAt: string
  updatedAt: string
}

export interface AdminOrderDetailView extends AdminOrderView {
  snapshotJson: Record<string, unknown> | null
  paymentTransactions: Array<{
    id: string
    provider: string
    providerRef: string | null
    status: string
    refundAmountCents: number
    refundStatus: string | null
    refundedAt: string | null
  }>
  fulfillment: {
    status: string | null
    subscriptionId: string | null
    creditsGranted: number
    errorMessage: string | null
    completedAt: string | null
  } | null
  ledger: Array<{
    id: string
    type: string
    amount: number
    balanceAfter: number
    description: string | null
    createdAt: string
  }>
}

export interface AdminGenerationView {
  id: string
  workspaceId: string
  userId: string
  type: string
  provider: string | null
  model: string | null
  status: string
  attemptCount: number
  estimatedCostMicrousd: number
  reportedCostMicrousd: number
  finalCostMicrousd: number
  costStatus: string
  providerJobId: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface AdminGenerationDetailView extends AdminGenerationView {
  quote: {
    id: string
    pricingVersionId: string
    estimatedCredits: number
    estimatedCostMicrousd: number
    inputSnapshot: Record<string, unknown> | null
    expiresAt: string | null
  } | null
  reservation: {
    id: string
    reservedCredits: number
    capturedCredits: number
    releasedCredits: number
    status: string
    settledAt: string | null
  } | null
  attempts: Array<{
    id: string
    attemptNo: number
    provider: string
    model: string
    status: string
    providerJobId: string | null
    errorCode: string | null
    errorMessage: string | null
    estimatedCostMicrousd: number
    reportedCostMicrousd: number
    startedAt: string
    endedAt: string | null
  }>
  outbox: Array<{
    id: string
    eventType: string
    status: string
    attempts: number
    lastError: string | null
    dispatchedAt: string | null
    createdAt: string
  }>
  usageEvent: {
    id: string
    estimatedCostMicrousd: number
    reportedCostMicrousd: number
    finalCostMicrousd: number
    costStatus: string
    creditsCharged: number
  } | null
}

export interface AdminStatsView {
  users: number
  workspaces: number
  generations: number
  generationsByStatus: Record<string, number>
  generationsByType: Record<string, number>
  totalBalance: number
  totalReservedBalance: number
  totalCreditsSpent: number
}

export interface AdminAuditView {
  id: string
  actorUserId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export interface Customer360View {
  user: { id: string; email: string; role: string; status: string; createdAt: string }
  workspace: {
    id: string
    name: string
    type: string
    role: string
    createdAt: string
  } | null
  wallet: { balance: number; reservedBalance: number; updatedAt: string } | null
  subscription: {
    id: string
    planId: string
    planName: string | null
    status: string
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
  } | null
  reservations: Array<{
    id: string
    generationJobId: string
    reservedCredits: number
    capturedCredits: number
    releasedCredits: number
    status: string
    createdAt: string
    settledAt: string | null
  }>
  ledger: Array<{
    id: string
    type: string
    amount: number
    balanceAfter: number
    description: string | null
    createdAt: string
  }>
  generationsSummary: {
    total: number
    byStatus: Record<string, number>
    totalEstimatedCostMicrousd: number
    totalFinalCostMicrousd: number
    totalCreditsCharged: number
  }
  payments: Array<{
    orderId: string
    orderType: string
    amountCents: number
    currency: string
    status: string
    fulfillmentStatus: string
    provider: string | null
    providerRef: string | null
    createdAt: string
  }>
  recentGenerations: Array<{
    id: string
    type: string
    provider: string | null
    model: string | null
    status: string
    estimatedCredits: number
    createdAt: string
  }>
  recentUsage: Array<{
    id: string
    type: string
    provider: string
    model: string
    estimatedCostMicrousd: number
    finalCostMicrousd: number
    costStatus: string
    creditsCharged: number
    createdAt: string
  }>
  audit: Array<{
    id: string
    action: string
    resourceType: string
    resourceId: string | null
    createdAt: string
  }>
}

export const adminStatsApi = {
  summary: () => json<AdminStatsView>('/stats'),
}

export const adminUsersApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    json<AdminUserView[]>(`/users?limit=${params.limit ?? 100}&offset=${params.offset ?? 0}`),
  setStatus: (id: string, status: string) =>
    json<AdminUserView>(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  adjustCredits: (id: string, delta: number, description?: string) =>
    json<{ balance: number; reservedBalance: number }>(`/users/${id}/credits`, {
      method: 'POST',
      body: JSON.stringify({ delta, description }),
    }),
}

export const adminCustomersApi = {
  get360: (userId: string) => json<Customer360View>(`/customers/${userId}/360`),
}

export const adminOrdersApi = {
  list: (params: { limit?: number; offset?: number; status?: string; orderType?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.limit != null) q.set('limit', String(params.limit))
    if (params.offset != null) q.set('offset', String(params.offset))
    if (params.status) q.set('status', params.status)
    if (params.orderType) q.set('orderType', params.orderType)
    return json<AdminOrderView[]>(`/orders?${q.toString()}`)
  },
  detail: (id: string) => json<AdminOrderDetailView>(`/orders/${id}`),
  retryFulfillment: (id: string) =>
    json<{ status: string; subscriptionId?: string; creditsGranted: number }>(`/orders/${id}/fulfillment/retry`, {
      method: 'POST',
    }),
  close: (id: string) => json<{ orderId: string; status: string }>(`/orders/${id}/close`, { method: 'POST' }),
}

export const adminGenerationsApi = {
  list: (params: { limit?: number; offset?: number; status?: string; workspaceId?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.limit != null) q.set('limit', String(params.limit))
    if (params.offset != null) q.set('offset', String(params.offset))
    if (params.status) q.set('status', params.status)
    if (params.workspaceId) q.set('workspaceId', params.workspaceId)
    return json<AdminGenerationView[]>(`/generations?${q.toString()}`)
  },
  detail: (id: string) => json<AdminGenerationDetailView>(`/generations/${id}`),
  forceFail: (id: string, reason: string) =>
    json<{ status: string; releasedCredits: number }>(`/generations/${id}/force-fail`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  replay: (id: string) => json<{ reset: number }>(`/generations/${id}/outbox/replay`, { method: 'POST' }),
}

export const adminAuditApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    json<AdminAuditView[]>(`/audit-logs?limit=${params.limit ?? 100}&offset=${params.offset ?? 0}`),
}

// ---------------------------------------------------------------------------
// Provider & Credential 管理（与 providers.admin.service / credentials.admin.service 对齐）
// ---------------------------------------------------------------------------

/** 后端 ProviderView 对齐。 */
export interface AdminProviderView {
  id: string
  code: string
  name: string
  baseUrl: string
  status: string
  config: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

/** 后端 CredentialView 对齐。不含 Secret 明文。 */
export interface AdminCredentialView {
  id: string
  providerId: string
  status: string
  priority: number
  weight: number
  maxConcurrency: number
  currentConcurrency: number
  cooldownUntil: string | null
  lastUsedAt: string | null
  lastError: string | null
  hasSecret: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProviderInput {
  code: string
  name: string
  baseUrl: string
  status?: string
  config?: Record<string, unknown>
}

export interface UpdateProviderInput {
  name?: string
  baseUrl?: string
  status?: string
  config?: Record<string, unknown>
}

export interface CreateCredentialInput {
  secret: string
  status?: string
  priority?: number
  weight?: number
  maxConcurrency?: number
}

export interface UpdateCredentialInput {
  secret?: string
  status?: string
  priority?: number
  weight?: number
  maxConcurrency?: number
  clearBackoff?: boolean
}

/**
 * 发送带 step-up password 的请求。
 * Credential create/update/delete 需要管理员二次验证密码。
 */
async function jsonWithStepUp<T>(
  url: string,
  options: RequestInit & { stepUpPassword?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!headers.has('X-Request-ID')) headers.set('X-Request-ID', newRequestId())
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (options.stepUpPassword) headers.set('x-step-up-password', options.stepUpPassword)
  const resp = await fetch(`${BASE}${url}`, { ...options, headers })
  if (!resp.ok) {
    const body = await resp.json().catch(() => undefined)
    throw new AdminApiError(resp.status, body, resp.statusText)
  }
  return (await resp.json()) as Promise<T>
}

export const adminProvidersApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    json<AdminProviderView[]>(`/providers?limit=${params.limit ?? 50}&offset=${params.offset ?? 0}`),
  create: (input: CreateProviderInput) =>
    json<AdminProviderView>('/providers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateProviderInput) =>
    json<AdminProviderView>(`/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (id: string) =>
    json<{ ok: true }>(`/providers/${id}`, { method: 'DELETE' }),
  /**
   * 简化的添加 Agnes 账号：只需 API Key，后端自动创建 Provider 和凭证。
   * 需要 step-up 密码验证。
   */
  createAgnesAccount: (apiKey: string, stepUpPassword: string) =>
    jsonWithStepUp<AdminCredentialView>('/providers/agnes/account', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
      stepUpPassword,
    }),
}

export const adminCredentialsApi = {
  listByProvider: (providerId: string) =>
    json<AdminCredentialView[]>(`/providers/${providerId}/credentials`),
  create: (providerId: string, input: CreateCredentialInput, stepUpPassword: string) =>
    jsonWithStepUp<AdminCredentialView>(`/providers/${providerId}/credentials`, {
      method: 'POST',
      body: JSON.stringify(input),
      stepUpPassword,
    }),
  update: (id: string, input: UpdateCredentialInput, stepUpPassword: string) =>
    jsonWithStepUp<AdminCredentialView>(`/credentials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      stepUpPassword,
    }),
  delete: (id: string, stepUpPassword: string) =>
    jsonWithStepUp<{ ok: true }>(`/credentials/${id}`, {
      method: 'DELETE',
      stepUpPassword,
    }),
}

const adminApi = {
  adminStatsApi,
  adminUsersApi,
  adminCustomersApi,
  adminOrdersApi,
  adminGenerationsApi,
  adminAuditApi,
  adminProvidersApi,
  adminCredentialsApi,
}

export default adminApi