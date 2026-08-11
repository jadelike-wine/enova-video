import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { eq, and } from 'drizzle-orm';
import { GENERATION_STATUSES, type GenerationStatus } from '@enova/contracts';
import { createDb, schema, type Database } from '@enova/db';

/**
 * SQLite（旧 backend，单租户）→ PostgreSQL（新 modular monolith）历史数据迁移。
 *
 * 迁移范围：
 *   conversations → conversations
 *   messages      → messages
 *   image_tasks   → generation_jobs(IMAGE) + assets
 *   video_tasks   → generation_jobs(VIDEO) + assets
 *   uploads       → assets(UPLOAD)
 *
 * 设计说明：
 * - 旧系统无用户/工作区概念，迁移时创建（或复用）一个合成用户 + 个人工作区承载全部历史数据。
 * - 每条记录在 legacy_migration 落一条映射（source+source_id 唯一），脚本可安全重跑跳过已迁移行。
 * - 默认 dry-run 只统计不写库；加 --execute 才真正写入。
 * - 对象存储/上游 URL 原样放入 output_json / asset.metadata，不做二次转存。
 */

export interface MigrationOptions {
  sqlitePath: string;
  databaseUrl: string;
  /** 合成用户邮箱（单租户承载）。默认 legacy@localhost。 */
  email?: string;
  /** 是否真正写库；false=仅统计（dry-run）。 */
  execute?: boolean;
}

export interface MigrationReport {
  email: string;
  workspaceId: string;
  conversations: number;
  messages: number;
  imageJobs: number;
  videoJobs: number;
  uploads: number;
  skipped: number;
  executed: boolean;
}

/** image_tasks.status → generation_status。 */
function mapImageStatus(status: unknown): GenerationStatus {
  switch (String(status ?? '').toLowerCase()) {
    case 'completed':
      return GENERATION_STATUSES.SUCCEEDED;
    case 'failed':
      return GENERATION_STATUSES.FAILED;
    case 'processing':
      return GENERATION_STATUSES.RUNNING;
    default:
      return GENERATION_STATUSES.QUEUED; // pending
  }
}

/** video_tasks.status → generation_status。 */
function mapVideoStatus(status: unknown): GenerationStatus {
  switch (String(status ?? '').toLowerCase()) {
    case 'completed':
      return GENERATION_STATUSES.SUCCEEDED;
    case 'failed':
      return GENERATION_STATUSES.FAILED;
    case 'in_progress':
      return GENERATION_STATUSES.RUNNING;
    default:
      return GENERATION_STATUSES.QUEUED; // submitting / queued
  }
}

/** SQLite 'YYYY-MM-DD HH:MM:SS'（localtime）→ Date。空值返回 null。 */
function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const s = String(value);
  // 无时区后缀按本地时间解析（旧库用 datetime('now','localtime')）。
  return new Date(s.includes('T') ? s : s.replace(' ', 'T'));
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

export async function migrateSqliteToPg(opts: MigrationOptions): Promise<MigrationReport> {
  const email = opts.email || 'legacy@localhost';
  const sqlite = new DatabaseSync(opts.sqlitePath);
  const db = createDb(opts.databaseUrl);
  const report: MigrationReport = {
    email,
    workspaceId: '',
    conversations: 0,
    messages: 0,
    imageJobs: 0,
    videoJobs: 0,
    uploads: 0,
    skipped: 0,
    executed: Boolean(opts.execute),
  };

  try {
    const holder = await ensureUserWorkspace(db, email);
    report.workspaceId = holder.workspaceId;

    report.conversations = await migrateConversations(sqlite, db, holder, opts.execute);
    report.messages = await migrateMessages(sqlite, db, holder, opts.execute);
    report.imageJobs = await migrateImageTasks(sqlite, db, holder, opts.execute);
    report.videoJobs = await migrateVideoTasks(sqlite, db, holder, opts.execute);
    report.uploads = await migrateUploads(sqlite, db, holder, opts.execute);

    return report;
  } finally {
    sqlite.close();
    await db.$client.end();
  }
}

interface Holder {
  userId: string;
  workspaceId: string;
}

async function ensureUserWorkspace(db: Database, email: string): Promise<Holder> {
  const existingUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existingUser[0]) {
    const userId = existingUser[0].id;
    const existingWs = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.ownerUserId, userId))
      .limit(1);
    if (existingWs[0]) return { userId, workspaceId: existingWs[0].id };
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'Legacy Workspace', type: 'PERSONAL', ownerUserId: userId })
      .returning({ id: schema.workspaces.id });
    return { userId, workspaceId: ws.id };
  }

  // 合成用户：不可用密码（随机 hash），日后可走找回/重置。
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: randomUUID().replace(/-/g, ''),
      status: 'ACTIVE',
      role: 'USER',
    })
    .returning({ id: schema.users.id });
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'Legacy Workspace', type: 'PERSONAL', ownerUserId: user.id })
    .returning({ id: schema.workspaces.id });
  return { userId: user.id, workspaceId: ws.id };
}

async function isMigrated(db: Database, source: string, sourceId: unknown): Promise<boolean> {
  if (sourceId == null) return true;
  const rows = await db
    .select({ id: schema.legacyMigration.id })
    .from(schema.legacyMigration)
    .where(
      and(
        eq(schema.legacyMigration.source, source),
        eq(schema.legacyMigration.sourceId, String(sourceId)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function recordMigration(
  db: Database,
  holder: Holder,
  source: string,
  sourceId: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.legacyMigration).values({
    legacyUserId: holder.userId,
    legacyWorkspaceId: holder.workspaceId,
    source,
    sourceId: String(sourceId),
    payload,
  });
}

async function migrateConversations(
  sqlite: DatabaseSync,
  db: Database,
  holder: Holder,
  execute: boolean | undefined,
): Promise<number> {
  const rows = sqlite.prepare('SELECT * FROM conversations ORDER BY id').all();
  if (!execute) return rows.length;

  let count = 0;
  for (const row of rows) {
    if (await isMigrated(db, 'conversation', row.id)) continue;
    const newId = randomUUID();
    await db.insert(schema.conversations).values({
      id: newId,
      workspaceId: holder.workspaceId,
      userId: holder.userId,
      title: str(row.title) ?? '新对话',
      createdAt: toDate(row.created_at) ?? new Date(),
      updatedAt: toDate(row.updated_at) ?? new Date(),
    });
    await recordMigration(db, holder, 'conversation', row.id, { newId });
    count++;
  }
  return count;
}

async function migrateMessages(
  sqlite: DatabaseSync,
  db: Database,
  holder: Holder,
  execute: boolean | undefined,
): Promise<number> {
  const rows = sqlite.prepare('SELECT * FROM messages ORDER BY id').all();
  if (!execute) return rows.length;

  // legacy conversation_id → 新 conversation uuid 映射（本脚本内会话迁移时已建立）。
  const conversationMap = new Map<string, string>();
  const convRows = await db
    .select({
      legacyId: schema.legacyMigration.sourceId,
      payload: schema.legacyMigration.payload,
    })
    .from(schema.legacyMigration)
    .where(eq(schema.legacyMigration.source, 'conversation'));
  for (const c of convRows) {
    const p = c.payload as { newId?: string } | undefined;
    if (p?.newId) conversationMap.set(c.legacyId, p.newId);
  }

  let count = 0;
  for (const row of rows) {
    if (await isMigrated(db, 'message', row.id)) continue;
    const convId = conversationMap.get(String(row.conversation_id));
    if (!convId) continue; // 孤儿消息：跳过（旧库 FK 级联删，理论上无孤儿）
    const newId = randomUUID();
    await db.insert(schema.messages).values({
      id: newId,
      conversationId: convId,
      workspaceId: holder.workspaceId,
      role: str(row.role) ?? 'user',
      content: String(row.content ?? ''),
      model: str(row.model),
      inputTokens: num(row.prompt_tokens),
      outputTokens: num(row.completion_tokens),
      createdAt: toDate(row.created_at) ?? new Date(),
    });
    await recordMigration(db, holder, 'message', row.id, { newId });
    count++;
  }
  return count;
}

async function migrateImageTasks(
  sqlite: DatabaseSync,
  db: Database,
  holder: Holder,
  execute: boolean | undefined,
): Promise<number> {
  const rows = sqlite.prepare('SELECT * FROM image_tasks ORDER BY id').all();
  if (!execute) return rows.length;

  let count = 0;
  for (const row of rows) {
    if (await isMigrated(db, 'image_task', row.id)) continue;
    const jobId = randomUUID();
    const assetId = randomUUID();
    const input: Record<string, unknown> = {
      prompt: row.prompt,
      mode: row.mode,
      size: row.size,
    };
    if (row.input_images) input.images = String(row.input_images).split(',');
    if (row.request_params) input.requestParams = row.request_params;

    await db.insert(schema.generationJobs).values({
      id: jobId,
      workspaceId: holder.workspaceId,
      userId: holder.userId,
      type: 'IMAGE',
      status: mapImageStatus(row.status),
      provider: 'agnes',
      model: str(row.model),
      inputJson: input,
      outputJson: {
        url: str(row.output_url) ?? str(row.qiniu_url),
        storageProvider: str(row.storage_provider),
        revisedPrompt: str(row.revised_prompt),
      },
      errorMessage: str(row.error_message),
      createdAt: toDate(row.created_at) ?? new Date(),
      completedAt: toDate(row.completed_at),
    });
    await db.insert(schema.assets).values({
      id: assetId,
      workspaceId: holder.workspaceId,
      userId: holder.userId,
      generationJobId: jobId,
      type: 'IMAGE',
      storageProvider: str(row.storage_provider) ?? 'none',
      objectKey: str(row.storage_key),
      metadata: {
        sourceUrl: str(row.output_url),
        qiniuUrl: str(row.qiniu_url),
        revisedPrompt: str(row.revised_prompt),
      },
      createdAt: toDate(row.created_at) ?? new Date(),
    });
    await recordMigration(db, holder, 'image_task', row.id, { newId: jobId, assetId });
    count++;
  }
  return count;
}

async function migrateVideoTasks(
  sqlite: DatabaseSync,
  db: Database,
  holder: Holder,
  execute: boolean | undefined,
): Promise<number> {
  const rows = sqlite.prepare('SELECT * FROM video_tasks ORDER BY id').all();
  if (!execute) return rows.length;

  let count = 0;
  for (const row of rows) {
    if (await isMigrated(db, 'video_task', row.id)) continue;
    const jobId = randomUUID();
    const assetId = randomUUID();
    const input: Record<string, unknown> = {
      prompt: row.prompt,
      mode: row.mode,
      width: num(row.width),
      height: num(row.height),
      numFrames: num(row.num_frames),
      frameRate: num(row.frame_rate),
    };
    if (row.negative_prompt) input.negativePrompt = row.negative_prompt;
    if (row.num_inference_steps) input.numInferenceSteps = num(row.num_inference_steps);
    if (row.seed) input.seed = num(row.seed);
    if (row.input_images) input.images = String(row.input_images).split(',');
    if (row.request_params) input.requestParams = row.request_params;

    await db.insert(schema.generationJobs).values({
      id: jobId,
      workspaceId: holder.workspaceId,
      userId: holder.userId,
      type: 'VIDEO',
      status: mapVideoStatus(row.status),
      provider: 'agnes',
      model: str(row.model),
      inputJson: input,
      providerJobId: str(row.task_id) ?? str(row.video_id),
      outputJson: {
        url: str(row.output_url) ?? str(row.qiniu_url),
        storageProvider: str(row.storage_provider),
      },
      errorMessage: str(row.error_message),
      createdAt: toDate(row.created_at) ?? new Date(),
      completedAt: toDate(row.completed_at),
    });
    await db.insert(schema.assets).values({
      id: assetId,
      workspaceId: holder.workspaceId,
      userId: holder.userId,
      generationJobId: jobId,
      type: 'VIDEO',
      storageProvider: str(row.storage_provider) ?? 'none',
      objectKey: str(row.storage_key),
      width: num(row.width) || null,
      height: num(row.height) || null,
      duration: num(row.duration_ms) || null,
      metadata: {
        sourceUrl: str(row.output_url),
        qiniuUrl: str(row.qiniu_url),
        progress: num(row.progress),
      },
      createdAt: toDate(row.created_at) ?? new Date(),
    });
    await recordMigration(db, holder, 'video_task', row.id, { newId: jobId, assetId });
    count++;
  }
  return count;
}

async function migrateUploads(
  sqlite: DatabaseSync,
  db: Database,
  holder: Holder,
  execute: boolean | undefined,
): Promise<number> {
  const rows = sqlite.prepare('SELECT * FROM uploads ORDER BY id').all();
  if (!execute) return rows.length;

  let count = 0;
  for (const row of rows) {
    if (await isMigrated(db, 'upload', row.id)) continue;
    await db.insert(schema.assets).values({
      workspaceId: holder.workspaceId,
      userId: holder.userId,
      type: 'UPLOAD',
      storageProvider: 'qiniu',
      objectKey: str(row.qiniu_key),
      mimeType: str(row.file_type),
      size: num(row.size_bytes),
      metadata: {
        filename: str(row.filename),
        originalName: str(row.original_name),
        qiniuUrl: str(row.qiniu_url),
      },
      createdAt: toDate(row.created_at) ?? new Date(),
    });
    await recordMigration(db, holder, 'upload', row.id, {});
    count++;
  }
  return count;
}