import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * 金额/数值单位约定（避免浮点误差）：
 * - credits：整数（bigint mode number），单位 = 1 credit。
 * - *_cost_usd：整数（integer），单位 = 微美元（1e-6 USD），即 1 USD = 1_000_000。
 * 所有金额计算必须使用整数运算。
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRole = pgEnum('user_role', ['USER', 'ADMIN']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'DISABLED']);
export const workspaceType = pgEnum('workspace_type', ['PERSONAL', 'TEAM']);
export const workspaceMemberRole = pgEnum('workspace_member_role', ['OWNER', 'ADMIN', 'MEMBER']);
export const generationType = pgEnum('generation_type', [
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'UPSCALE',
  'LIPSYNC',
  'IMAGE_TO_VIDEO',
  'VIDEO_TO_VIDEO',
]);
export const generationStatus = pgEnum('generation_status', [
  'PENDING',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
]);
export const assetType = pgEnum('asset_type', ['IMAGE', 'VIDEO', 'UPLOAD']);
export const walletLedgerType = pgEnum('wallet_ledger_type', [
  'WELCOME',
  'RECHARGE',
  'GENERATION_RESERVE',
  'GENERATION_SETTLE',
  'GENERATION_RELEASE',
  'REFUND', // LEGACY ONLY. 产品策略不支持自动退款，禁止新增 REFUND ledger 写入。
  'SUBSCRIPTION_GRANT',
  'ADMIN_ADJUSTMENT',
]);
export const providerStatus = pgEnum('provider_status', ['ACTIVE', 'DISABLED']);
export const credentialStatus = pgEnum('credential_status', ['ACTIVE', 'COOLDOWN', 'ERROR', 'DISABLED']);
export const paymentStatus = pgEnum('payment_status', ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']); // REFUNDED: LEGACY ONLY. 产品策略不支持自动退款，禁止新写入。
export const subscriptionStatus = pgEnum('subscription_status', ['ACTIVE', 'CANCELED', 'PAST_DUE', 'EXPIRED']);
export const reservationStatus = pgEnum('reservation_status', ['RESERVED', 'PARTIALLY_CAPTURED', 'CAPTURED', 'RELEASED']);
export const costStatus = pgEnum('cost_status', ['ESTIMATED', 'REPORTED', 'RECONCILED']);
export const outboxStatus = pgEnum('outbox_status', ['PENDING', 'DISPATCHED', 'SUPERSEDED']);
export const attemptStatus = pgEnum('attempt_status', ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED']);
export const orderType = pgEnum('order_type', ['RECHARGE', 'PLAN', 'CREDIT_PACK']);
export const fulfillmentStatus = pgEnum('fulfillment_status', ['PENDING', 'SUCCEEDED', 'FAILED']);
export const pricingVersionStatus = pgEnum('pricing_version_status', ['DRAFT', 'PUBLISHED', 'ARCHIVED']);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  status: userStatus('status').notNull().default('ACTIVE'),
  role: userRole('role').notNull().default('USER'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_unique').on(t.email)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('sessions_user_id_idx').on(t.userId)]);

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  type: workspaceType('type').notNull().default('PERSONAL'),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('workspaces_owner_user_id_idx').on(t.ownerUserId)]);

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: workspaceMemberRole('role').notNull().default('MEMBER'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('workspace_members_workspace_id_idx').on(t.workspaceId),
  index('workspace_members_user_id_idx').on(t.userId),
  uniqueIndex('workspace_members_ws_user_unique').on(t.workspaceId, t.userId),
]);

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull().default('新对话'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('conversations_workspace_id_idx').on(t.workspaceId)]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(),
  content: text('content').notNull(),
  model: varchar('model', { length: 100 }),
  provider: varchar('provider', { length: 50 }),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('messages_conversation_id_idx').on(t.conversationId),
  index('messages_workspace_id_idx').on(t.workspaceId),
]);

// ---------------------------------------------------------------------------
// Generation (统一任务系统)
// ---------------------------------------------------------------------------
export const generationJobs = pgTable('generation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: generationType('type').notNull(),
  status: generationStatus('status').notNull().default('PENDING'),
  provider: varchar('provider', { length: 50 }),
  model: varchar('model', { length: 100 }),
  inputJson: jsonb('input_json').$type<Record<string, unknown>>(),
  outputJson: jsonb('output_json').$type<Record<string, unknown>>(),
  providerJobId: varchar('provider_job_id', { length: 255 }),
  /** 视频提交后到上游的 Provider Job Id（轮询用）。 */
  providerStartedAt: timestamp('provider_started_at', { withTimezone: true }),
  /** 视频轮询计数，达到上限判定超时（防止永久轮询）。 */
  pollCount: integer('poll_count').notNull().default(0),
  estimatedCredits: bigint('estimated_credits', { mode: 'number' }).notNull().default(0),
  reservedCredits: bigint('reserved_credits', { mode: 'number' }).notNull().default(0),
  actualCredits: bigint('actual_credits', { mode: 'number' }).notNull().default(0),
  /** @deprecated 保留兼容；新逻辑使用 estimatedCostMicrousd。 */
  estimatedCostUsd: integer('estimated_cost_usd').notNull().default(0),
  /** @deprecated 保留兼容；新逻辑使用 finalCostMicrousd。 */
  actualCostUsd: integer('actual_cost_usd').notNull().default(0),
  /** 估算供应商成本（微美元，1 USD = 1_000_000）。来自 PriceQuote 快照。 */
  estimatedCostMicrousd: integer('estimated_cost_microusd').notNull().default(0),
  /** Provider 回报的实际成本（微美元）。未回报时为 0。 */
  reportedCostMicrousd: integer('reported_cost_microusd').notNull().default(0),
  /** 最终确认成本（微美元）。reconciliation 后写入。 */
  finalCostMicrousd: integer('final_cost_microusd').notNull().default(0),
  /** 成本状态：ESTIMATED=仅估算；REPORTED=Provider 已回报；RECONCILED=账单核对完成。 */
  costStatus: costStatus('cost_status').notNull().default('ESTIMATED'),
  /** 关联的不可变价格版本（追溯定价历史）。 */
  pricingVersionId: uuid('pricing_version_id').references(() => pricingVersions.id, { onDelete: 'set null' }),
  /** 关联的价格快照 Quote（追溯下单时报价）。FK 由 price_quotes.generation_job_id 反向保证，此处仅存 ID 避免循环引用。 */
  priceQuoteId: uuid('price_quote_id'),
  /** 总 attempt 次数（含失败/fallback），便于快速查询。 */
  attemptCount: integer('attempt_count').notNull().default(0),
  errorCode: varchar('error_code', { length: 100 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  queuedAt: timestamp('queued_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
}, (t) => [
  index('generation_jobs_workspace_id_idx').on(t.workspaceId),
  index('generation_jobs_status_idx').on(t.status),
  index('generation_jobs_provider_job_id_idx').on(t.providerJobId),
  index('generation_jobs_pricing_version_id_idx').on(t.pricingVersionId),
]);

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  generationJobId: uuid('generation_job_id').references(() => generationJobs.id, { onDelete: 'set null' }),
  type: assetType('type').notNull(),
  storageProvider: varchar('storage_provider', { length: 50 }),
  bucket: varchar('bucket', { length: 255 }),
  objectKey: varchar('object_key', { length: 1024 }),
  mimeType: varchar('mime_type', { length: 120 }),
  size: bigint('size', { mode: 'number' }).notNull().default(0),
  width: integer('width'),
  height: integer('height'),
  duration: bigint('duration', { mode: 'number' }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('assets_workspace_id_idx').on(t.workspaceId),
  // 幂等边界：一个 Generation Job 最终只允许一个主要 Asset，Worker 重试不会重复插入。
  uniqueIndex('assets_generation_job_id_unique').on(t.generationJobId),
]);

// ---------------------------------------------------------------------------
// Provider & Credential
// ---------------------------------------------------------------------------
export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  status: providerStatus('status').notNull().default('ACTIVE'),
  config: jsonb('config').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('providers_code_unique').on(t.code)]);

export const providerCredentials = pgTable('provider_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: uuid('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  /** AES-GCM 加密后的 Secret（带 iv + tag），绝不存明文。 */
  encryptedSecret: text('encrypted_secret').notNull(),
  status: credentialStatus('status').notNull().default('ACTIVE'),
  priority: integer('priority').notNull().default(0),
  weight: integer('weight').notNull().default(1),
  maxConcurrency: integer('max_concurrency').notNull().default(1),
  currentConcurrency: integer('current_concurrency').notNull().default(0),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('provider_credentials_provider_id_idx').on(t.providerId),
  index('provider_credentials_status_idx').on(t.status),
]);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  reservedBalance: bigint('reserved_balance', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('wallets_workspace_id_unique').on(t.workspaceId)]);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 订单类型：RECHARGE=充值 credits；PLAN=购买套餐；CREDIT_PACK=购买额外 credit 包。 */
  orderType: orderType('order_type').notNull().default('RECHARGE'),
  amountCents: integer('amount_cents').notNull().default(0),
  amountUsd: integer('amount_usd').notNull().default(0),
  /** ISO 4217 货币代码（CNY/USD），下单时快照。 */
  currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
  credits: bigint('credits', { mode: 'number' }).notNull().default(0),
  /** 关联的 Plan（仅 PLAN 类型订单）。 */
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
  /** 订单快照：下单时的商品/价格/credits/plan entitlement 不可变副本。履约时读此字段，不重查当前价格。 */
  snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>(),
  status: paymentStatus('status').notNull().default('PENDING'),
  /** 履约状态：PENDING=待履约；SUCCEEDED=已履约；FAILED=履约失败。与 payment status 独立。 */
  fulfillmentStatus: fulfillmentStatus('fulfillment_status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('orders_workspace_id_idx').on(t.workspaceId),
  index('orders_status_idx').on(t.status),
]);

export const walletLedger = pgTable('wallet_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: walletLedgerType('type').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  balanceBefore: bigint('balance_before', { mode: 'number' }).notNull(),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
  reservedBefore: bigint('reserved_before', { mode: 'number' }).notNull().default(0),
  reservedAfter: bigint('reserved_after', { mode: 'number' }).notNull().default(0),
  generationJobId: uuid('generation_job_id').references(() => generationJobs.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wallet_ledger_workspace_id_idx').on(t.workspaceId),
  uniqueIndex('wallet_ledger_idempotency_key_unique').on(t.idempotencyKey),
]);

export const pricingRules = pgTable('pricing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  generationType: generationType('generation_type').notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  credits: bigint('credits', { mode: 'number' }).notNull(),
  pricingJson: jsonb('pricing_json').$type<Record<string, unknown>>(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pricing_rules_type_provider_model_idx').on(t.generationType, t.provider, t.model),
]);

export const usageEvents = pgTable('usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  generationJobId: uuid('generation_job_id').references(() => generationJobs.id, { onDelete: 'set null' }),
  provider: varchar('provider', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  type: generationType('type').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  duration: bigint('duration', { mode: 'number' }),
  resolution: varchar('resolution', { length: 50 }),
  /** @deprecated 保留兼容；新逻辑使用 estimatedCostMicrousd。 */
  providerCostUsd: integer('provider_cost_usd').notNull().default(0),
  /** 估算供应商成本（微美元）。来自 PriceQuote 快照。 */
  estimatedCostMicrousd: integer('estimated_cost_microusd').notNull().default(0),
  /** Provider 回报的实际成本（微美元）。 */
  reportedCostMicrousd: integer('reported_cost_microusd').notNull().default(0),
  /** 最终确认成本（微美元）。 */
  finalCostMicrousd: integer('final_cost_microusd').notNull().default(0),
  /** 成本状态。 */
  costStatus: costStatus('cost_status').notNull().default('ESTIMATED'),
  creditsCharged: bigint('credits_charged', { mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('usage_events_workspace_id_idx').on(t.workspaceId),
  index('usage_events_generation_job_id_idx').on(t.generationJobId),
  // 幂等去重：同一 generation_job 只产生一条 usage event。
  uniqueIndex('usage_events_generation_job_id_unique').on(t.generationJobId),
]);

// ---------------------------------------------------------------------------
// Billing / Payments (Phase 7 预留)
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  /** 每月/每周期发放的 credits（整数）。0 = 不含 credits。 */
  monthlyCredits: bigint('monthly_credits', { mode: 'number' }).notNull().default(0),
  /** 价格（分，人民币）。 */
  priceCents: integer('price_cents').notNull().default(0),
  /** 货币代码。 */
  currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
  /** @deprecated 保留兼容。 */
  priceUsd: integer('price_usd').notNull().default(0),
  /** 周期天数（30=月套餐；365=年套餐；0=一次性买断/credit pack）。 */
  periodDays: integer('period_days').notNull().default(30),
  /** 是否为一次性购买（非自动续费）。credit pack / 买断 plan 为 true。 */
  oneTime: boolean('one_time').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  /** Entitlements：最大并发生成数。 */
  maxConcurrentGenerations: integer('max_concurrent_generations').notNull().default(1),
  /** Entitlements：最大分辨率（如 1080）。 */
  maxResolution: integer('max_resolution').notNull().default(720),
  /** Entitlements：最大视频时长（秒）。 */
  maxDurationSeconds: integer('max_duration_seconds').notNull().default(10),
  /** Entitlements：存储保留天数。 */
  storageRetentionDays: integer('storage_retention_days').notNull().default(30),
  /** Entitlements：队列优先级（0=最低，10=最高）。 */
  priority: integer('priority').notNull().default(0),
  /** Entitlements：是否带水印。 */
  watermark: boolean('watermark').notNull().default(true),
  /** Entitlements：是否允许商用。 */
  commercialUse: boolean('commercial_use').notNull().default(false),
  /** Entitlements：允许访问的模型列表（空 = 全部允许）。 */
  allowedModels: jsonb('allowed_models').$type<string[]>(),
  /** 额外 entitlements（灵活扩展，但不作为核心字段）。 */
  entitlementsJson: jsonb('entitlements_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('plans_code_unique').on(t.code)]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: subscriptionStatus('status').notNull().default('ACTIVE'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('subscriptions_workspace_id_idx').on(t.workspaceId)]);

export const paymentTransactions = pgTable('payment_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull(),
  /** 第三方交易号（支付宝 trade_no / 微信 transaction_id）。非空时全局唯一，防止同一渠道交易重复入账。 */
  providerRef: varchar('provider_ref', { length: 255 }),
  status: paymentStatus('status').notNull().default('PENDING'),
  /** 回调原始报文（审计用）。 */
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  /**
   * LEGACY ONLY. Automated refunds are intentionally unsupported by product policy.
   * Do not add new writes to these fields without an explicit product decision.
   *
   * 产品策略：Enova Video 暂不支持任何自动退款（Credit Recharge / Credit Pack / Plan 均不可退款）。
   * 这些字段仅保留用于 migration safety 与历史数据展示，业务代码禁止写入 refund_status/refund_ref/refunded_at，
   * 也禁止新增 REFUND ledger 或 REFUNDED 状态。极端线下人工退款见 Admin Credit Adjustment 流程。
   */
  refundAmountCents: integer('refund_amount_cents').notNull().default(0),
  refundStatus: paymentStatus('refund_status'),
  refundRef: varchar('refund_ref', { length: 255 }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('payment_transactions_order_id_idx').on(t.orderId),
  // provider_ref 非空时唯一（同一渠道交易号不能对应多条记录），防止重复回调重复入账。
  uniqueIndex('payment_transactions_provider_ref_unique').on(t.providerRef),
]);

// ---------------------------------------------------------------------------
// Credit Reservations (P0-1: per-job reservation)
// ---------------------------------------------------------------------------
export const creditReservations = pgTable('credit_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  /** 一个 generation job 最多一个 reservation（唯一约束）。 */
  generationJobId: uuid('generation_job_id').notNull().references(() => generationJobs.id, { onDelete: 'cascade' }),
  reservedCredits: bigint('reserved_credits', { mode: 'number' }).notNull(),
  capturedCredits: bigint('captured_credits', { mode: 'number' }).notNull().default(0),
  releasedCredits: bigint('released_credits', { mode: 'number' }).notNull().default(0),
  status: reservationStatus('status').notNull().default('RESERVED'),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('credit_reservations_generation_job_id_unique').on(t.generationJobId),
  uniqueIndex('credit_reservations_idempotency_key_unique').on(t.idempotencyKey),
  index('credit_reservations_wallet_id_idx').on(t.walletId),
  index('credit_reservations_status_idx').on(t.status),
]);

// ---------------------------------------------------------------------------
// Generation Dispatch Outbox (P0-2: transactional outbox)
// ---------------------------------------------------------------------------
export const generationDispatchOutbox = pgTable('generation_dispatch_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  generationJobId: uuid('generation_job_id').notNull().references(() => generationJobs.id, { onDelete: 'cascade' }),
  /** 事件类型：PROCESS=首次执行；CANCEL=取消。 */
  eventType: varchar('event_type', { length: 50 }).notNull(),
  /** payload 快照（BullMQ job data 的 JSON 副本）。 */
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  status: outboxStatus('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  /** 下次可投递时间（用于退避重试）。 */
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
}, (t) => [
  index('generation_dispatch_outbox_status_available_at_idx').on(t.status, t.availableAt),
  index('generation_dispatch_outbox_generation_job_id_idx').on(t.generationJobId),
  // P0 红队：同一 job 的同一事件类型至多一条 outbox 行。
  // 防止两个 dispatcher 实例并发 reconcile 时对同一孤儿 job 各插入一条 PENDING 行，
  // 导致重复投递 → 重复执行/重复调 Provider（重复成本）。
  uniqueIndex('generation_dispatch_outbox_job_event_unique').on(t.generationJobId, t.eventType),
]);

// ---------------------------------------------------------------------------
// Pricing Versions (P0-3: immutable pricing version)
// ---------------------------------------------------------------------------
export const pricingVersions = pgTable('pricing_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 关联的 pricing rule（可为 null 表示全局默认版本）。 */
  pricingRuleId: uuid('pricing_rule_id').references(() => pricingRules.id, { onDelete: 'set null' }),
  /** 版本号（同一 rule 内递增）。 */
  version: integer('version').notNull().default(1),
  generationType: generationType('generation_type').notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  /** 定价维度快照（duration/resolution/quality 等）。 */
  dimensionsJson: jsonb('dimensions_json').$type<Record<string, unknown>>(),
  /** Credits 定价公式/固定值。 */
  credits: bigint('credits', { mode: 'number' }).notNull(),
  /** 完整定价配置（含 providerCostMicrousd 等）。发布后不可变。 */
  pricingJson: jsonb('pricing_json').$type<Record<string, unknown>>(),
  status: pricingVersionStatus('status').notNull().default('DRAFT'),
  effectiveAt: timestamp('effective_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (t) => [
  index('pricing_versions_rule_version_idx').on(t.pricingRuleId, t.version),
  index('pricing_versions_type_provider_model_idx').on(t.generationType, t.provider, t.model),
  uniqueIndex('pricing_versions_rule_version_unique').on(t.pricingRuleId, t.version),
]);

// ---------------------------------------------------------------------------
// Price Quotes (P0-3: immutable quote at job creation)
// ---------------------------------------------------------------------------
export const priceQuotes = pgTable('price_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  generationJobId: uuid('generation_job_id').references(() => generationJobs.id, { onDelete: 'set null' }),
  pricingVersionId: uuid('pricing_version_id').notNull().references(() => pricingVersions.id, { onDelete: 'restrict' }),
  /** 下单时的输入参数快照（用于追溯定价依据）。 */
  inputSnapshot: jsonb('input_snapshot').$type<Record<string, unknown>>(),
  estimatedCredits: bigint('estimated_credits', { mode: 'number' }).notNull(),
  /** 估算收入（分，人民币）。 */
  estimatedRevenueCents: integer('estimated_revenue_cents').notNull().default(0),
  /** 估算供应商成本（微美元）。 */
  estimatedCostMicrousd: integer('estimated_cost_microusd').notNull().default(0),
  /** Quote 过期时间（超过则需重新报价）。 */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('price_quotes_generation_job_id_idx').on(t.generationJobId),
  index('price_quotes_pricing_version_id_idx').on(t.pricingVersionId),
]);

// ---------------------------------------------------------------------------
// Generation Attempts (P0-5: per-provider-call records)
// ---------------------------------------------------------------------------
export const generationAttempts = pgTable('generation_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  generationJobId: uuid('generation_job_id').notNull().references(() => generationJobs.id, { onDelete: 'cascade' }),
  /** 尝试序号（同一 job 内递增）。 */
  attemptNo: integer('attempt_no').notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  credentialId: uuid('credential_id'),
  /** 上游 Provider Job Id（视频提交后得到）。 */
  providerJobId: varchar('provider_job_id', { length: 255 }),
  status: attemptStatus('status').notNull().default('RUNNING'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  errorCode: varchar('error_code', { length: 100 }),
  errorMessage: text('error_message'),
  /** 本次尝试的估算成本（微美元）。 */
  estimatedCostMicrousd: integer('estimated_cost_microusd').notNull().default(0),
  /** Provider 回报的实际成本（微美元）。失败 attempt 也记录成本。 */
  reportedCostMicrousd: integer('reported_cost_microusd').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
}, (t) => [
  uniqueIndex('generation_attempts_job_attempt_unique').on(t.generationJobId, t.attemptNo),
  index('generation_attempts_generation_job_id_idx').on(t.generationJobId),
  index('generation_attempts_status_idx').on(t.status),
]);

// ---------------------------------------------------------------------------
// Subscription Fulfillments (P0-7: idempotent fulfillment)
// ---------------------------------------------------------------------------
export const subscriptionFulfillments = pgTable('subscription_fulfillments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  status: fulfillmentStatus('status').notNull().default('PENDING'),
  /** 发放的 credits 数（PLAN 类型订单的套餐 credits）。 */
  creditsGranted: bigint('credits_granted', { mode: 'number' }).notNull().default(0),
  /** 幂等键（= orderId），保证同一订单只履约一次。 */
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('subscription_fulfillments_idempotency_key_unique').on(t.idempotencyKey),
  index('subscription_fulfillments_order_id_idx').on(t.orderId),
]);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 120 }).notNull(),
  resourceType: varchar('resource_type', { length: 80 }).notNull(),
  resourceId: varchar('resource_id', { length: 120 }),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  /** 操作原因（高危操作必填）。 */
  reason: text('reason'),
  /** 请求 ID（关联 API request-id）。 */
  requestId: varchar('request_id', { length: 120 }),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('admin_audit_logs_actor_user_id_idx').on(t.actorUserId),
  index('admin_audit_logs_resource_type_idx').on(t.resourceType),
  index('admin_audit_logs_created_at_idx').on(t.createdAt),
]);

// ---------------------------------------------------------------------------
// Settings (动态配置，管理员后台可改)
// ---------------------------------------------------------------------------
export const settings = pgTable('settings', {
  key: varchar('key', { length: 120 }).primaryKey(),
  /** 字符串形式存储；按 schema 注册的 valueType 解析。 */
  value: text('value').notNull().default(''),
  /** 解析类型：string / number / boolean / enum。 */
  valueType: varchar('value_type', { length: 20 }).notNull().default('string'),
  /** 分组，用于后台界面分类展示。 */
  group: varchar('group', { length: 80 }).notNull().default('general'),
  /** 是否敏感（如密钥）；返回后台时脱敏。 */
  isSecret: boolean('is_secret').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('settings_group_idx').on(t.group)]);

// ---------------------------------------------------------------------------
// Legacy (单租户历史数据迁移归集)
// ---------------------------------------------------------------------------
export const legacyMigration = pgTable('legacy_migration', {
  id: uuid('id').primaryKey().defaultRandom(),
  legacyUserId: uuid('legacy_user_id').notNull(),
  legacyWorkspaceId: uuid('legacy_workspace_id').notNull(),
  source: varchar('source', { length: 50 }).notNull(),
  sourceId: varchar('source_id', { length: 120 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('legacy_migration_source_source_id_unique').on(t.source, t.sourceId)]);

// ---------------------------------------------------------------------------
// Relations（供 query API with: {} 使用）
// ---------------------------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(workspaceMembers),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerUserId], references: [users.id] }),
  members: many(workspaceMembers),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  workspace: one(workspaces, { fields: [wallets.workspaceId], references: [workspaces.id] }),
}));