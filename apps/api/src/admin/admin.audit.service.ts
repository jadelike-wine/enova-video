import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { adminAuditLogs, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export interface AdminAuditView {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface RecordAuditParams {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * 管理员操作审计：所有 Admin 写操作落 admin_audit_logs，便于追责与回滚。
 * 约定：before / after 绝不含敏感字段（如 Credential Secret）——调用方负责脱敏。
 */
@Injectable()
export class AdminAuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 记录一条审计日志（不抛错，审计失败不影响主流程）。 */
  async record(params: RecordAuditParams): Promise<void> {
    try {
      await this.db.insert(adminAuditLogs).values({
        actorUserId: params.actorUserId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        before: params.before,
        after: params.after,
        ip: params.ip,
        userAgent: params.userAgent,
      });
    } catch (err) {
      // 审计失败静默：不因审计问题阻断 Admin 操作。
      console.error('admin audit record failed', err);
    }
  }

  async list(limit: number, offset: number, actorUserId?: string): Promise<AdminAuditView[]> {
    const limitSafe = Math.min(Math.max(limit, 1), 100);
    const offsetSafe = Math.max(offset, 0);
    const rows = await this.db
      .select()
      .from(adminAuditLogs)
      .where(actorUserId ? eq(adminAuditLogs.actorUserId, actorUserId) : undefined)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(limitSafe)
      .offset(offsetSafe);
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      before: r.before,
      after: r.after,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
    }));
  }
}