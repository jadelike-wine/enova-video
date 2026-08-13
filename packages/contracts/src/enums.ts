/**
 * 领域枚举（Enum）与共享常量。
 * 前端、API、Worker、DB 全部通过本包共享，避免字符串散落与漂移。
 */

export const USER_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const USER_STATUSES = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];

export const WORKSPACE_TYPES = {
  PERSONAL: 'PERSONAL',
  TEAM: 'TEAM',
} as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[keyof typeof WORKSPACE_TYPES];

export const WORKSPACE_MEMBER_ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;
export type WorkspaceMemberRole =
  (typeof WORKSPACE_MEMBER_ROLES)[keyof typeof WORKSPACE_MEMBER_ROLES];

/** GenerationJob 类型：统一生成系统，未来可扩展。 */
export const GENERATION_TYPES = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  // 预留（Schema 已支持，MVP 不实现）：
  AUDIO: 'AUDIO',
  UPSCALE: 'UPSCALE',
  LIPSYNC: 'LIPSYNC',
  IMAGE_TO_VIDEO: 'IMAGE_TO_VIDEO',
  VIDEO_TO_VIDEO: 'VIDEO_TO_VIDEO',
} as const;
export type GenerationType = (typeof GENERATION_TYPES)[keyof typeof GENERATION_TYPES];

/** GenerationJob 状态机；禁止非法跳转（见 packages/db 的 status 迁移约束）。 */
export const GENERATION_STATUSES = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const;
export type GenerationStatus =
  (typeof GENERATION_STATUSES)[keyof typeof GENERATION_STATUSES];

export const ASSET_TYPES = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  UPLOAD: 'UPLOAD',
} as const;
export type AssetType = (typeof ASSET_TYPES)[keyof typeof ASSET_TYPES];

/** WalletLedger 类型：每一笔余额变化必须可审计。 */
export const WALLET_LEDGER_TYPES = {
  WELCOME: 'WELCOME',
  RECHARGE: 'RECHARGE',
  GENERATION_RESERVE: 'GENERATION_RESERVE',
  GENERATION_SETTLE: 'GENERATION_SETTLE',
  GENERATION_RELEASE: 'GENERATION_RELEASE',
  REFUND: 'REFUND',
  SUBSCRIPTION_GRANT: 'SUBSCRIPTION_GRANT',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
} as const;
export type WalletLedgerType =
  (typeof WALLET_LEDGER_TYPES)[keyof typeof WALLET_LEDGER_TYPES];

export const PROVIDER_STATUSES = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[keyof typeof PROVIDER_STATUSES];

export const CREDENTIAL_STATUSES = {
  ACTIVE: 'ACTIVE',
  COOLDOWN: 'COOLDOWN',
  ERROR: 'ERROR',
  DISABLED: 'DISABLED',
} as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[keyof typeof CREDENTIAL_STATUSES];

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export const SUBSCRIPTION_STATUSES = {
  ACTIVE: 'ACTIVE',
  CANCELED: 'CANCELED',
  PAST_DUE: 'PAST_DUE',
  EXPIRED: 'EXPIRED',
} as const;
export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUSES)[keyof typeof SUBSCRIPTION_STATUSES];

/** 内建后台角色（P1-5 RBAC）。注意：user_role enum 仍为 USER/ADMIN 用于登录身份；
 * 此处 role 是授权角色，通过 user_role_assignments 绑定到用户。 */
export const ADMIN_ROLES = {
  SUPPORT: 'SUPPORT',
  OPERATOR: 'OPERATOR',
  FINANCE: 'FINANCE',
  DEVELOPER: 'DEVELOPER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type AdminRole = (typeof ADMIN_ROLES)[keyof typeof ADMIN_ROLES];

/** 后台权限点（P1-5）。作为 role_permissions 中的权限标识。 */
export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_DISABLE: 'users.disable',
  WALLET_READ: 'wallet.read',
  WALLET_ADJUST: 'wallet.adjust',
  ORDERS_READ: 'orders.read',
  ORDERS_FULFILL: 'orders.fulfill',
  PAYMENTS_READ: 'payments.read',
  GENERATION_READ: 'generation.read',
  GENERATION_REPLAY: 'generation.replay',
  GENERATION_FORCE_FAIL: 'generation.force_fail',
  PRICING_READ: 'pricing.read',
  PRICING_WRITE: 'pricing.write',
  PRICING_PUBLISH: 'pricing.publish',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
  SETTINGS_SECURITY_WRITE: 'settings.security_write',
  AUDIT_READ: 'audit.read',
  PROVIDERS_READ: 'providers.read',
  PROVIDERS_WRITE: 'providers.write',
  CREDENTIALS_ROTATE: 'credentials.rotate',
  ROLE_ASSIGN: 'role.assign',
  ANALYTICS_READ: 'analytics.read',
  COUPON_WRITE: 'coupon.write',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** 成本事件类型（P1-1）。 */
export const COST_TYPES = {
  VIDEO_GENERATION: 'VIDEO_GENERATION',
  IMAGE_GENERATION: 'IMAGE_GENERATION',
  LLM: 'LLM',
  TTS: 'TTS',
  STORAGE: 'STORAGE',
  EGRESS: 'EGRESS',
  GPU: 'GPU',
  THIRD_PARTY: 'THIRD_PARTY',
} as const;
export type CostType = (typeof COST_TYPES)[keyof typeof COST_TYPES];

/** 收入事件类型（P1-1）。 */
export const REVENUE_TYPES = {
  RECHARGE: 'RECHARGE',
  PLAN: 'PLAN',
  CREDIT_PACK: 'CREDIT_PACK',
  GENERATION: 'GENERATION',
} as const;
export type RevenueType = (typeof REVENUE_TYPES)[keyof typeof REVENUE_TYPES];

/** 试用状态（P1-8）。 */
export const TRIAL_STATUSES = {
  NONE: 'NONE',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CONVERTED: 'CONVERTED',
} as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[keyof typeof TRIAL_STATUSES];

/** BullMQ 队列名（API 与 Worker 共享，避免字符串漂移）。 */
export const QUEUES = {
  GENERATION: 'generation',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Generation 队列的任务名。 */
export const GENERATION_JOB_NAMES = {
  PROCESS: 'generation.process',
  /** 视频延迟轮询（同一队列，delay 触发）。 */
  POLL: 'generation.poll',
  /** 取消（RUNNING 视频需通知上游 cancelJob 后释放，由 Worker 处理以免泄露凭据）。 */
  CANCEL: 'generation.cancel',
} as const;
export type GenerationJobName =
  (typeof GENERATION_JOB_NAMES)[keyof typeof GENERATION_JOB_NAMES];

/**
 * Generation 队列 Job 数据（API → Worker 的契约）。
 * 不含敏感字段（Provider Secret 由 Credential Manager 在 Worker 内选取/解密）。
 */
export interface GenerationJobPayload {
  generationJobId: string;
  workspaceId: string;
  userId: string;
  type: GenerationType;
  provider: string;
  model: string;
  input: Record<string, unknown>;
  /** 排入队列时已 reserve 的 credits，用于幂等结算。 */
  reservedCredits: number;
  idempotencyKey: string;
  /** 执行阶段：execute=首次提交/分发；poll=视频延迟轮询；cancel=取消（通知上游+释放）。 */
  stage?: 'execute' | 'poll' | 'cancel';
  /** 视频轮询计数，达到上限判定超时。 */
  pollCount?: number;
  /** 已持久化的 Provider Job Id（视频提交后写入，重试不再重复提交）。 */
  providerJobId?: string;
}