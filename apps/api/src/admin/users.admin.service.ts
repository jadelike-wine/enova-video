import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { domainError, ERROR_CODES, type UserStatus } from '@enova/contracts';
import { users, workspaceMembers, wallets, type Database } from '@enova/db';
import { WalletService } from '../billing/wallet.service.js';
import { DATABASE } from '../database/database.module.js';

export interface AdminUserView {
  id: string;
  email: string;
  role: string;
  status: string;
  workspaceId: string | null;
  workspaceRole: string | null;
  balance: number;
  reservedBalance: number;
  createdAt: Date;
}

/**
 * 用户管理（Admin）：列表、启/禁用、调整余额。
 * 调整余额基于用户主要 Workspace（最早的 member 记录），经 WalletService 走同一套账本逻辑。
 */
@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async list(limit: number, offset: number): Promise<AdminUserView[]> {
    const limitSafe = Math.min(Math.max(limit, 1), 100);
    const offsetSafe = Math.max(offset, 0);
    const rows = await this.db.select().from(users).orderBy(desc(users.createdAt)).limit(limitSafe).offset(offsetSafe);

    const views: AdminUserView[] = [];
    for (const u of rows) {
      views.push(await this.toView(u.id));
    }
    return views;
  }

  async setStatus(userId: string, status: UserStatus): Promise<AdminUserView> {
    const u = await this.requireUser(userId);
    if (u.status === status) return this.toView(userId);
    await this.db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
    return this.toView(userId);
  }

  /** 返回用户当前 status（供审计 before 使用）。 */
  async getStatus(userId: string): Promise<string> {
    const u = await this.requireUser(userId);
    return u.status;
  }

  /** 调整用户主要 Workspace 余额（正负均可，负数不能使余额为负）。 */
  async adjustCredits(
    userId: string,
    delta: number,
    description?: string,
  ): Promise<{ balance: number; reservedBalance: number }> {
    await this.requireUser(userId);
    const membership = await this.primaryMembership(userId);
    if (!membership) throw domainError(ERROR_CODES.NOT_WORKSPACE_MEMBER, 'User has no workspace', 404);

    const wallet = await this.wallet.adjustBalance(
      membership.workspaceId,
      delta,
      `admin:adjust:${randomUUID()}`,
      description ?? 'Admin credits adjustment',
    );

    const walletRows = await this.db
      .select({ reservedBalance: wallets.reservedBalance })
      .from(wallets)
      .where(eq(wallets.workspaceId, membership.workspaceId))
      .limit(1);
    return { balance: wallet.balance, reservedBalance: walletRows[0]?.reservedBalance ?? 0 };
  }

  private async primaryMembership(userId: string) {
    const rows = await this.db
      .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(workspaceMembers.createdAt)
      .limit(1);
    return rows[0];
  }

  private async toView(userId: string): Promise<AdminUserView> {
    const u = await this.requireUser(userId);
    const membership = await this.primaryMembership(userId);
    let balance = 0;
    let reservedBalance = 0;
    if (membership) {
      const w = await this.db
        .select({ balance: wallets.balance, reservedBalance: wallets.reservedBalance })
        .from(wallets)
        .where(eq(wallets.workspaceId, membership.workspaceId))
        .limit(1);
      balance = w[0]?.balance ?? 0;
      reservedBalance = w[0]?.reservedBalance ?? 0;
    }
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      workspaceId: membership?.workspaceId ?? null,
      workspaceRole: membership?.role ?? null,
      balance,
      reservedBalance,
      createdAt: u.createdAt,
    };
  }

  private async requireUser(userId: string) {
    const rows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const u = rows[0];
    if (!u) throw domainError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    return u;
  }
}