import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  ADMIN_ROLES,
  domainError,
  ERROR_CODES,
  USER_ROLES,
  USER_STATUSES,
  WORKSPACE_MEMBER_ROLES,
  WORKSPACE_TYPES,
  type ErrorCode,
} from '@enova/contracts';
import { RbacStore, type Tx } from '@enova/billing';
import {
  emailVerificationTokens,
  passwordResetTokens,
  sessions,
  userAgreementAcceptances,
  users,
  wallets,
  walletLedger,
  workspaceMembers,
  workspaces,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { PasswordService } from './password.service.js';
import { SessionService, SESSION_TTL_SECONDS } from './session.service.js';
import { TurnstileService } from './turnstile.service.js';
import { LoginAgreementService } from '../settings/login-agreement.service.js';

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

/** 会话视图（不含 token hash 明文，只暴露安全所需字段）。P1-6。 */
export interface SessionView {
  id: string;
  ip: string | null;
  userAgent: string | null;
  deviceName: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  revoked: boolean;
}

export interface AuthRequestOptions {
  admin?: boolean;
  agreementRevision?: string;
  userAgent?: string;
  invitationCode?: string;
  promoCode?: string;
}

function fail(code: ErrorCode, message: string, statusCode = 400): never {
  throw domainError(code, message, statusCode);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SettingsService) private readonly settings: SettingsService,
    private readonly password: PasswordService,
    private readonly session: SessionService,
    private readonly turnstile: TurnstileService,
    @Inject(RbacStore) private readonly rbacStore: RbacStore,
    @Inject(LoginAgreementService) private readonly loginAgreement?: LoginAgreementService,
  ) {}

  /** 注册：事务内创建 User + Personal Workspace + Member + Wallet + Welcome Credits + Session。 */
  async register(
    email: string,
    plainPassword: string,
    turnstileToken?: string,
    remoteIP?: string,
    opts: AuthRequestOptions = {},
    transaction?: Tx,
  ): Promise<AuthResult & { token: string }> {
    // 首启创建管理员走 setup.init，不经过人机验证和注册策略检查；普通注册始终校验。
    if (!opts.admin) {
      // 1. 开放注册检查
      const openRegistration = (await this.settings.getBoolean('auth.openRegistration')) ?? true;
      if (!openRegistration) {
        fail(ERROR_CODES.REGISTRATION_DISABLED, 'Registration is disabled', 403);
      }

      await this.turnstile.verify(turnstileToken, remoteIP ?? '');
      await this.loginAgreement?.assertCurrentRevision(opts.agreementRevision);

      // 2. 邀请码检查
      const requireInvitationCode = (await this.settings.getBoolean('auth.requireInvitationCode')) ?? false;
      if (requireInvitationCode) {
        if (!opts.invitationCode || !opts.invitationCode.trim()) {
          fail(ERROR_CODES.INVITATION_CODE_REQUIRED, 'Invitation code is required', 400);
        }
        // 邀请码有效性校验（预留接口，当前仅校验非空和长度）
        // 实际的邀请码数据库校验需在邀请码表建立后接入
      }
    }
    const normalized = email.trim().toLowerCase();

    // 3. 邮箱域名白名单检查
    await this.validateEmailDomainPolicy(normalized);

    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    if (existing.length > 0) {
      fail(ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'Email already registered', 409);
    }

    // 4. 非白名单域名限量注册检查
    await this.validateNonWhitelistDomainQuota(normalized);

    const passwordHash = await this.password.hash(plainPassword);
    const token = this.session.issueToken();
    const tokenHash = this.session.hashToken(token);
    const welcome = (await this.settings.getNumber('billing.welcomeCredits')) ?? 0;

    const createAccount = async (tx: Tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: normalized,
          passwordHash,
          role: opts.admin ? USER_ROLES.ADMIN : USER_ROLES.USER,
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

      if (opts.admin) {
        await this.rbacStore.assignRole(user.id, ADMIN_ROLES.SUPER_ADMIN, undefined, tx);
      }

      if (opts.agreementRevision && this.loginAgreement) {
        await tx
          .insert(userAgreementAcceptances)
          .values({
            userId: user.id,
            revision: opts.agreementRevision,
            ip: remoteIP ?? null,
            userAgent: opts.userAgent ?? null,
          })
          .onConflictDoNothing({
            target: [userAgreementAcceptances.userId, userAgreementAcceptances.revision],
          });
      }

      return { userId: user.id, email: user.email, role: user.role, status: user.status, workspaceId: workspace.id, balance: wallet.balance, reservedBalance: wallet.reservedBalance };
    };
    const result = transaction
      ? await createAccount(transaction)
      : await this.db.transaction(createAccount);

    // 5. 邮箱验证：开启时注册后发送验证邮件
    if (await this.shouldRequireEmailVerification()) {
      try {
        await this.createEmailVerificationToken(result.userId, transaction);
      } catch {
        // Best-effort: don't fail registration if token creation fails
      }
    }

    if (opts.admin) {
      this.logger.log(`[setup] Created initial admin user ${result.email}`);
    }

    // 6. 优惠码处理（预留接口，当前仅记录日志）
    if (opts.promoCode) {
      const enablePromoCode = (await this.settings.getBoolean('auth.enablePromoCode')) ?? false;
      if (enablePromoCode) {
        this.logger.log(`[register] Promo code applied for user ${result.userId}: ${opts.promoCode}`);
        // 实际的优惠码验证和应用需在优惠码表建立后接入
      }
    }

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

  /** 是否需要邮箱验证。 */
  private async shouldRequireEmailVerification(): Promise<boolean> {
    return (await this.settings.getBoolean('auth.emailVerification')) ?? false;
  }

  /** 邮箱域名白名单策略校验。 */
  private async validateEmailDomainPolicy(email: string): Promise<void> {
    const whitelistRaw = (await this.settings.getString('auth.emailDomainWhitelist')) ?? '[]';
    const whitelist = this.parseEmailDomainWhitelist(whitelistRaw);
    if (whitelist.length === 0) return; // 白名单为空，不限制

    const domain = this.extractEmailDomain(email);
    if (!domain) return;

    if (this.isEmailDomainInWhitelist(domain, whitelist)) return;

    // 非白名单域名：如果限量注册开关关闭，直接拒绝
    const nonWhitelistDomainLimit = (await this.settings.getBoolean('auth.nonWhitelistDomainLimit')) ?? false;
    if (!nonWhitelistDomainLimit) {
      fail(ERROR_CODES.EMAIL_DOMAIN_NOT_ALLOWED, 'Email domain is not in the whitelist', 403);
    }
  }

  /** 非白名单域名限量注册检查：每个主域名最多注册一个账户。 */
  private async validateNonWhitelistDomainQuota(email: string): Promise<void> {
    const whitelistRaw = (await this.settings.getString('auth.emailDomainWhitelist')) ?? '[]';
    const whitelist = this.parseEmailDomainWhitelist(whitelistRaw);
    if (whitelist.length === 0) return; // 白名单为空，不限制

    const domain = this.extractEmailDomain(email);
    if (!domain) return;

    // 如果邮箱在白名单中，不需要限量检查
    if (this.isEmailDomainInWhitelist(domain, whitelist)) return;

    // 非白名单域名：检查限量注册开关
    const nonWhitelistDomainLimit = (await this.settings.getBoolean('auth.nonWhitelistDomainLimit')) ?? false;
    if (!nonWhitelistDomainLimit) return; // 开关关闭，已在 validateEmailDomainPolicy 中拒绝

    // 检查该主域名下是否已有注册用户
    const mainDomain = this.normalizeToMainDomain(domain);
    const likePattern = `%@${mainDomain}`;
    const existingCount = await this.db
      .select({ n: count() })
      .from(users)
      .where(sql`${users.email} LIKE ${likePattern}`)
      .limit(1);

    if ((existingCount[0]?.n ?? 0) > 0) {
      fail(ERROR_CODES.EMAIL_DOMAIN_REGISTRATION_LIMIT, 'Registration limit reached for this email domain', 403);
    }
  }

  /** 解析邮箱域名白名单 JSON。 */
  private parseEmailDomainWhitelist(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    } catch {
      return [];
    }
  }

  /** 从邮箱地址提取域名。 */
  private extractEmailDomain(email: string): string {
    const at = email.lastIndexOf('@');
    if (at < 0 || at === email.length - 1) return '';
    return email.slice(at + 1).toLowerCase();
  }

  /** 检查域名是否在白名单中。 */
  private isEmailDomainInWhitelist(domain: string, whitelist: string[]): boolean {
    for (const allowed of whitelist) {
      const normalized = allowed.trim().toLowerCase();
      if (normalized.startsWith('@')) {
        // @example.com 匹配 example.com
        if (domain === normalized.slice(1)) return true;
      } else if (normalized.startsWith('*.')) {
        // *.edu.cn 匹配 edu.cn 及其子域名
        const base = normalized.slice(2);
        if (domain === base || domain.endsWith('.' + base)) return true;
      } else {
        // 纯域名格式
        if (domain === normalized) return true;
      }
    }
    return false;
  }

  /** 将域名归一为可注册主域名（简单实现：取最后两段）。 */
  private normalizeToMainDomain(domain: string): string {
    const parts = domain.split('.');
    if (parts.length <= 2) return domain;
    return parts.slice(-2).join('.');
  }

  /** 登录：校验密码 + 状态，创建新的 Session。 */
  async login(
    email: string,
    plainPassword: string,
    turnstileToken?: string,
    remoteIP?: string,
    opts: AuthRequestOptions = {},
  ): Promise<AuthResult & { token: string }> {
    await this.turnstile.verify(turnstileToken, remoteIP ?? '');
    await this.loginAgreement?.assertCurrentRevision(opts.agreementRevision);
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
    await this.db.transaction(async (tx) => {
      await tx.insert(sessions).values({
        userId: user.id,
        tokenHash,
        expiresAt,
        ip: remoteIP || null,
        userAgent: opts.userAgent ?? null,
      });

      if (opts.agreementRevision && this.loginAgreement) {
        await tx
          .insert(userAgreementAcceptances)
          .values({
            userId: user.id,
            revision: opts.agreementRevision,
            ip: remoteIP ?? null,
            userAgent: opts.userAgent ?? null,
          })
          .onConflictDoNothing({
            target: [userAgreementAcceptances.userId, userAgreementAcceptances.revision],
          });
      }
    });

    const context = await this.loadAuthContext(user.id);
    return { ...context, token };
  }

  /** 登出：删除当前 Session。 */
  async logout(userId: string, tokenHash: string): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.userId, userId)));
  }

  // ---- P1-6: Session 管理（列出 / 撤销单条 / 撤销其它 / 改密）----

  /** 列出用户全部 session（含已撤销/过期，revoked 字段标记其状态）。 */
  async listSessions(userId: string): Promise<SessionView[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(sessions.createdAt);
    const now = Date.now();
    return rows.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      deviceName: s.deviceName,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      revoked: !!s.revokedAt || s.expiresAt.getTime() < now,
    }));
  }

  /** 撤销指定 session（管理员可跨用户，用户自身只能撤销自己的）。 */
  async revokeSession(userId: string, sessionId: string, opts: { allowOtherUser?: boolean } = {}): Promise<void> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    const session = rows[0];
    if (!session) fail(ERROR_CODES.NOT_FOUND, 'Session not found', 404);
    if (session.userId !== userId && !opts.allowOtherUser) {
      fail(ERROR_CODES.FORBIDDEN, 'Not allowed to revoke this session', 403);
    }
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  /** 撤销当前用户除指定 tokenHash 外的所有 session（用于"退出其它设备"）。 */
  async revokeAllOtherSessions(userId: string, keepTokenHash: string): Promise<number> {
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepTokenHash), isNull(sessions.revokedAt)));
    return res.rowCount ?? 0;
  }

  /** 修改密码：校验当前密码 → 更新 hash → 撤销其它 session（保留当前）。 */
  async changePassword(userId: string, currentPassword: string, newPassword: string, keepTokenHash?: string): Promise<void> {
    const rows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = rows[0];
    if (!user) fail(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    if (user.passwordHash && !(await this.password.verify(currentPassword, user.passwordHash))) {
      fail(ERROR_CODES.INVALID_CREDENTIALS, 'Current password is incorrect', 401);
    }
    const newHash = await this.password.hash(newPassword);
    await this.db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, userId));
    // P1.5: Revoke all other sessions after password change
    if (keepTokenHash) {
      await this.revokeAllOtherSessions(userId, keepTokenHash);
    } else {
      // If no token hash provided, revoke ALL sessions
      await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
    }
  }

  /** 撤销用户所有 session。 */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
  }

  // ---- P1.5: Password Reset ----

  /** 发起密码重置：创建短有效期、单次使用的 reset token（只存 hash）。 */
  async requestPasswordReset(email: string): Promise<string | null> {
    // 检查是否启用忘记密码功能
    const enablePasswordReset = (await this.settings.getBoolean('auth.enablePasswordReset')) ?? true;
    if (!enablePasswordReset) {
      fail(ERROR_CODES.PASSWORD_RESET_DISABLED, 'Password reset is disabled', 403);
    }

    const normalized = email.trim().toLowerCase();
    const rows = await this.db.select().from(users).where(eq(users.email, normalized)).limit(1);
    const user = rows[0];
    if (!user) return null; // 静默不泄露邮箱是否存在

    const rawToken = this.session.issueToken();
    const tokenHash = this.session.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 分钟

    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return rawToken;
  }

  /** 重置密码：校验 token → 更新密码 → 标记 token 已用 → 撤销所有 session。 */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.session.hashToken(rawToken);
    const rows = await this.db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
    const token = rows[0];
    if (!token) fail(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid or expired reset token', 400);
    if (token.usedAt) fail(ERROR_CODES.INVALID_CREDENTIALS, 'Reset token already used', 400);
    if (token.expiresAt.getTime() < Date.now()) fail(ERROR_CODES.INVALID_CREDENTIALS, 'Reset token expired', 400);

    const newHash = await this.password.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, token.userId));
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, token.id));
      // Revoke ALL sessions for this user
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, token.userId));
    });
  }

  // ---- P1.5: Email Verification ----

  /** 生成邮箱验证 token（只存 hash）。 */
  async createEmailVerificationToken(userId: string, transaction?: Tx): Promise<string> {
    const rawToken = this.session.issueToken();
    const tokenHash = this.session.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 小时

    await (transaction ?? this.db).insert(emailVerificationTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });

    return rawToken;
  }

  /** 验证邮箱：校验 token → 设置 emailVerifiedAt → 标记 token 已用。 */
  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = this.session.hashToken(rawToken);
    const rows = await this.db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.tokenHash, tokenHash)).limit(1);
    const token = rows[0];
    if (!token) fail(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid verification token', 400);
    if (token.usedAt) fail(ERROR_CODES.INVALID_CREDENTIALS, 'Verification token already used', 400);
    if (token.expiresAt.getTime() < Date.now()) fail(ERROR_CODES.INVALID_CREDENTIALS, 'Verification token expired', 400);

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, token.userId));
      await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.id, token.id));
    });
  }

  /** 获取用户邮箱验证状态。 */
  async getEmailVerification(userId: string): Promise<boolean> {
    const rows = await this.db.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0]?.emailVerifiedAt != null;
  }

  /** 根据 Session token 的哈希解析当前身份。非法/过期/已撤销返回 null。 */
  async resolveSession(tokenHash: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    const session = rows[0];
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;
    if (session.revokedAt) return null; // P1-6: 已撤销 session 立即失效

    // 更新 last_seen（best-effort，不影响鉴权结果）。
    await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id));

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

  /** 是否存在管理员账号（决定首启 setup 是否展示）。 */
  async hasAdminUser(): Promise<boolean> {
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .where(eq(users.role, USER_ROLES.ADMIN));
    return (row?.n ?? 0) > 0;
  }

  /** 首启创建管理员：仅当系统尚无管理员时可用，成功后授予 SUPER_ADMIN 并返回已登录会话。 */
  async createAdmin(email: string, plainPassword: string, remoteIP?: string): Promise<AuthResult & { token: string }> {
    return this.db.transaction(async (tx) => {
      // Serialize all setup attempts across API instances. The lock lives for
      // this transaction, which also creates the account and RBAC assignment.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('enova:setup:init'))`);
      const [row] = await tx
        .select({ n: count() })
        .from(users)
        .where(eq(users.role, USER_ROLES.ADMIN));
      if ((row?.n ?? 0) > 0) {
        fail(ERROR_CODES.CONFLICT, 'Admin already initialized', 409);
      }
      return this.register(email, plainPassword, undefined, remoteIP, { admin: true }, tx);
    });
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
