import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { conversations, messages, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export interface ConversationView {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface MessageView {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  provider?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
}

/**
 * 会话服务。所有查询/写入都强制带 workspaceId —— 绝不允许裸 findById。
 * 任何跨 Workspace 访问都会返回 IDOR_FORBIDDEN。
 */
@Injectable()
export class ConversationsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(workspaceId: string, limit: number, cursor?: string): Promise<ConversationView[]> {
    const rows = await this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        messageCount: sql<number>`(select count(*) from messages m where m.conversation_id = ${conversations.id})`,
      })
      .from(conversations)
      .where(cursor ? eq(conversations.id, cursor) : eq(conversations.workspaceId, workspaceId))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows;
  }

  async create(workspaceId: string, userId: string, title: string): Promise<ConversationView> {
    const [row] = await this.db
      .insert(conversations)
      .values({ workspaceId, userId, title: title.trim() || '新对话' })
      .returning();
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: 0,
    };
  }

  async get(workspaceId: string, id: string): Promise<ConversationView> {
    const row = await this.findByIdAndWorkspace(workspaceId, id);
    if (!row) throw domainError(ERROR_CODES.GENERATION_NOT_FOUND, 'Conversation not found', 404);
    const countRows = await this.db
      .select({ count: messages.conversationId })
      .from(messages)
      .where(eq(messages.conversationId, id));
    return { id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt, messageCount: countRows.length };
  }

  async updateTitle(workspaceId: string, id: string, title: string): Promise<ConversationView> {
    const row = await this.findByIdAndWorkspace(workspaceId, id);
    if (!row) throw domainError(ERROR_CODES.NOT_FOUND, 'Conversation not found', 404);
    const [updated] = await this.db
      .update(conversations)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)))
      .returning();
    return { id: updated.id, title: updated.title, createdAt: updated.createdAt, updatedAt: updated.updatedAt, messageCount: 0 };
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const row = await this.findByIdAndWorkspace(workspaceId, id);
    if (!row) throw domainError(ERROR_CODES.NOT_FOUND, 'Conversation not found', 404);
    await this.db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)));
  }

  async listMessages(workspaceId: string, conversationId: string): Promise<MessageView[]> {
    await this.ensureScoped(workspaceId, conversationId);
    return this.db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
        provider: messages.provider,
        model: messages.model,
        inputTokens: messages.inputTokens,
        outputTokens: messages.outputTokens,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.workspaceId, workspaceId)))
      .orderBy(messages.createdAt);
  }

  async appendMessages(
    workspaceId: string,
    conversationId: string,
    items: { role: string; content: string; provider?: string; model?: string }[],
  ): Promise<MessageView[]> {
    await this.ensureScoped(workspaceId, conversationId);
    if (items.length === 0) return [];
    const rows = await this.db
      .insert(messages)
      .values(items.map((m) => ({ conversationId, workspaceId, ...m })))
      .returning();
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      role: r.role,
      content: r.content,
      provider: r.provider,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      createdAt: r.createdAt,
    }));
  }

  /** 校验会话属于该 Workspace，否则抛 IDOR_FORBIDDEN。 */
  private async ensureScoped(workspaceId: string, conversationId: string): Promise<void> {
    const row = await this.findByIdAndWorkspace(workspaceId, conversationId);
    if (!row) throw domainError(ERROR_CODES.IDOR_FORBIDDEN, 'Forbidden', 403);
  }

  /** IDOR 安全：按 id + workspace 查询。 */
  private async findByIdAndWorkspace(
    workspaceId: string,
    id: string,
  ): Promise<{ id: string; title: string; createdAt: Date; updatedAt: Date } | undefined> {
    const rows = await this.db
      .select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)))
      .limit(1);
    return rows[0];
  }
}