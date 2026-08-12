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

export default {
  adminStatsApi,
  adminUsersApi,
  adminCustomersApi,
  adminOrdersApi,
  adminGenerationsApi,
  adminAuditApi,
}