import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  domainError,
  ERROR_CODES,
  USER_ROLES,
  USER_STATUSES,
  WORKSPACE_MEMBER_ROLES,
  WORKSPACE_TYPES,
  type ErrorCode,
} from '@enova/contracts';
import {
  sessions,
  users,
  wallets,
  walletLedger,
  workspaceMembers,
  workspaces,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';
import { PasswordService } from './password.service.js';
import { SessionService, SESSION_TTL_SECONDS } from './session.service.js';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  status: string;
  workspaceId: string;
  workspaceRole: string;
}

export interface AuthResult {
  user: AuthUser;
  balance: number;
  reservedBalance: number;
}

function fail(code: ErrorCode, message: string, statusCode = 400): never {
  throw domainError(code, message, statusCode);
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly password: PasswordService,
    private readonly session: SessionService,
  ) {}

  /** 注册：事务内创建 User + Personal Workspace + Member + Wallet + Welcome Credits + Session。 */
  async register(email: string, plainPassword: string): Promise<AuthResult & { token: string }> {
    const normalized = email.trim().toLowerCase();

    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    if (existing.length > 0) {
      fail(ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'Email already registered', 409);
    }

    const passwordHash = await this.password.hash(plainPassword);
    const token = this.session.issueToken();
    const tokenHash = this.session.hashToken(token);

    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: normalized,
          passwordHash,
          // 配置的首个管理员邮箱注册即授予 ADMIN（配置驱动，避免额外提权流程）。
          role: this.isInitialAdmin(normalized) ? USER_ROLES.ADMIN : USER_ROLES.USER,
          status: USER_STATUSES.ACTIVE,
        })
        .returning();

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: `${user.email}'s workspace`,
          type: WORKSPACE_TYPES.PERSONAL,
          ownerUserId: user.id,
        })
        .returning();

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: WORKSPACE_MEMBER_ROLES.OWNER,
      });

      const welcome = this.env.WELCOME_CREDITS;
      const [wallet] = await tx
        .insert(wallets)
        .values({ workspaceId: workspace.id, balance: welcome, reservedBalance: 0 })
        .returning();

      if (welcome > 0) {
        await tx.insert(walletLedger).values({
          workspaceId: workspace.id,
          type: 'WELCOME',
          amount: welcome,
          balanceBefore: 0,
          balanceAfter: welcome,
          reservedBefore: 0,
          reservedAfter: 0,
          idempotencyKey: `welcome:${user.id}`,
          description: 'Welcome credits',
        });
      }

      const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
      await tx.insert(sessions).values({ userId: user.id, tokenHash, expiresAt });

      return { userId: user.id, email: user.email, role: user.role, status: user.status, workspaceId: workspace.id, balance: wallet.balance, reservedBalance: wallet.reservedBalance };
    });

    return {
      user: {
        userId: result.userId,
        email: result.email,
        role: result.role,
        status: result.status,
        workspaceId: result.workspaceId,
        workspaceRole: WORKSPACE_MEMBER_ROLES.OWNER,
      },
      balance: result.balance,
      reservedBalance: result.reservedBalance,
      token,
    };
  }

  /** 登录：校验密码 + 状态，创建新的 Session。 */
  async login(email: string, plainPassword: string): Promise<AuthResult & { token: string }> {
    const normalized = email.trim().toLowerCase();
    const rows = await this.db.select().from(users).where(eq(users.email, normalized)).limit(1);
    const user = rows[0];
    if (!user || !(await this.password.verify(plainPassword, user.passwordHash))) {
      fail(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password', 401);
    }
    if (user.status === USER_STATUSES.DISABLED) {
      fail(ERROR_CODES.USER_DISABLED, 'Account disabled', 403);
    }

    const token = this.session.issueToken();
    const tokenHash = this.session.hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    await this.db.insert(sessions).values({ userId: user.id, tokenHash, expiresAt });

    const context = await this.loadAuthContext(user.id);
    return { ...context, token };
  }

  /** 登出：删除当前 Session。 */
  async logout(userId: string, tokenHash: string): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.userId, userId)));
  }

  /** 根据 Session token 的哈希解析当前身份。非法/过期返回 null。 */
  async resolveSession(tokenHash: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    const session = rows[0];
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;

    const userRows = await this.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    const user = userRows[0];
    if (!user || user.status === USER_STATUSES.DISABLED) return null;

    const context = await this.loadAuthContext(user.id);
    return context.user;
  }

  async current(userId: string): Promise<AuthResult> {
    return this.loadAuthContext(userId);
  }

  /** 供守卫对 cookie 中的原始 token 求哈希以查库。 */
  mustHashToken(rawToken: string): string {
    return this.session.hashToken(rawToken);
  }

  /** 是否为配置的首个管理员邮箱（INITIAL_ADMIN_EMAIL）。 */
  private isInitialAdmin(email: string): boolean {
    const configured = this.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    return Boolean(configured && configured === email);
  }

  /** 解析用户身份 + 其 Personal Workspace + Wallet 余额。 */
  private async loadAuthContext(userId: string): Promise<AuthResult> {
    const members = await this.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(workspaceMembers.createdAt)
      .limit(1);
    const membership = members[0];
    if (!membership) fail(ERROR_CODES.NOT_WORKSPACE_MEMBER, 'No workspace found', 403);

    const userRows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) fail(ERROR_CODES.NOT_FOUND, 'User not found', 404);

    const walletRows = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.workspaceId, membership.workspaceId))
      .limit(1);

    return {
      user: {
        userId: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        workspaceId: membership.workspaceId,
        workspaceRole: membership.role,
      },
      balance: walletRows[0]?.balance ?? 0,
      reservedBalance: walletRows[0]?.reservedBalance ?? 0,
    };
  }
}