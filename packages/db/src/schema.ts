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
  'REFUND',
  'SUBSCRIPTION_GRANT',
  'ADMIN_ADJUSTMENT',
]);
export const providerStatus = pgEnum('provider_status', ['ACTIVE', 'DISABLED']);
export const credentialStatus = pgEnum('credential_status', ['ACTIVE', 'COOLDOWN', 'ERROR', 'DISABLED']);
export const paymentStatus = pgEnum('payment_status', ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']);
export const subscriptionStatus = pgEnum('subscription_status', ['ACTIVE', 'CANCELED', 'PAST_DUE', 'EXPIRED']);

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
  estimatedCostUsd: integer('estimated_cost_usd').notNull().default(0),
  actualCostUsd: integer('actual_cost_usd').notNull().default(0),
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
  amountCents: integer('amount_cents').notNull().default(0),
  amountUsd: integer('amount_usd').notNull().default(0),
  credits: bigint('credits', { mode: 'number' }).notNull().default(0),
  status: paymentStatus('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('orders_workspace_id_idx').on(t.workspaceId)]);

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
  /** 供应商实际成本（微美元）。与 credits_charged 分开记录。 */
  providerCostUsd: integer('provider_cost_usd').notNull().default(0),
  creditsCharged: bigint('credits_charged', { mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('usage_events_workspace_id_idx').on(t.workspaceId),
  index('usage_events_generation_job_id_idx').on(t.generationJobId),
]);

// ---------------------------------------------------------------------------
// Billing / Payments (Phase 7 预留)
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  monthlyCredits: bigint('monthly_credits', { mode: 'number' }).notNull().default(0),
  priceUsd: integer('price_usd').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
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
  providerRef: varchar('provider_ref', { length: 255 }),
  status: paymentStatus('status').notNull().default('PENDING'),
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('payment_transactions_order_id_idx').on(t.orderId),
  index('payment_transactions_provider_ref_idx').on(t.providerRef),
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
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('admin_audit_logs_actor_user_id_idx').on(t.actorUserId)]);

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