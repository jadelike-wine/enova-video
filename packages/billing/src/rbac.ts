/**
 * P1-5: RBAC 领域服务（roles / permissions / assignments / step-up 审计）。
 *
 * 纯 Node / 非 NestJS，可被 Admin API 直接使用。核心不变量：
 * - 权限由 role_permissions 决定，用户通过 user_role_assignments 获得角色。
 * - requirePermission 基于已解析的权限集合做原子判断，返回布尔或抛 PERMISSION_DENIED。
 * - 高危操作统一写入 sensitive_action_logs（append-only），记录 actor/permission/target
 *   /before/after/reason/requestId/stepUpMethod。
 *
 * 本轮：Global Admin 权限正确为先；不实现 Enterprise tenant IAM。
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  roles,
  permissions,
  rolePermissions,
  userRoleAssignments,
  sensitiveActionLogs,
  type Database,
} from '@enova/db';
import {
  ADMIN_ROLES,
  PERMISSIONS,
  type AdminRole,
  type Permission,
} from '@enova/contracts';

/** 权限不足错误。 */
export class PermissionDeniedError extends Error {
  constructor(
    readonly permission: Permission,
    readonly userId?: string,
  ) {
    super(`PERMISSION_DENIED: ${permission}`);
    this.name = 'PermissionDeniedError';
  }
}

/** 高危操作需 step-up 复核。 */
export class StepUpRequiredError extends Error {
  constructor(readonly permission: Permission) {
    super(`STEP_UP_REQUIRED: ${permission}`);
    this.name = 'StepUpRequiredError';
  }
}

/** StepUp 验证器接口：当前若已有 MFA/TOTP 接入，由上层实现；否则可用 PASSWORD 复查实现。 */
export interface StepUpVerifier {
  verify(params: {
    userId: string;
    permission: Permission;
    method?: StepUpMethod;
  }): Promise<{ ok: boolean; method: StepUpMethod; reason?: string }>;
}

export type StepUpMethod = 'PASSWORD' | 'TOTP' | 'MFA' | 'NONE';

/** 内建角色 → 权限映射（seed 依据）。 */
export const DEFAULT_ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPPORT: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.GENERATION_READ,
    PERMISSIONS.PRICING_READ,
    PERMISSIONS.PROVIDERS_READ,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.AUDIT_READ,
  ],
  OPERATOR: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_FULFILL,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.GENERATION_READ,
    PERMISSIONS.GENERATION_REPLAY,
    PERMISSIONS.GENERATION_FORCE_FAIL,
    PERMISSIONS.PRICING_READ,
    PERMISSIONS.PROVIDERS_READ,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.AUDIT_READ,
  ],
  FINANCE: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_ADJUST,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.PRICING_READ,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.AUDIT_READ,
  ],
  DEVELOPER: [
    PERMISSIONS.GENERATION_READ,
    PERMISSIONS.PROVIDERS_READ,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.SETTINGS_WRITE,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.AUDIT_READ,
  ],
  ADMIN: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_DISABLE,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_ADJUST,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_FULFILL,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.GENERATION_READ,
    PERMISSIONS.GENERATION_REPLAY,
    PERMISSIONS.GENERATION_FORCE_FAIL,
    PERMISSIONS.PRICING_READ,
    PERMISSIONS.PRICING_WRITE,
    PERMISSIONS.PRICING_PUBLISH,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.SETTINGS_WRITE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.PROVIDERS_READ,
    PERMISSIONS.PROVIDERS_WRITE,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.COUPON_WRITE,
  ],
  SUPER_ADMIN: Object.values(PERMISSIONS),
};

export class RbacStore {
  constructor(private readonly db: Database) {}

  /** 幂等地预置内建角色、权限与角色-权限映射。 */
  async seed(): Promise<void> {
    // 权限
    const permRows = await this.db
      .insert(permissions)
      .values(
        Object.values(PERMISSIONS).map((code) => ({ code, name: code })),
      )
      .onConflictDoNothing({ target: permissions.code })
      .returning();
    const permIdByCode = new Map<string, string>();
    for (const p of permRows) permIdByCode.set(p.code, p.id);
    // 已存在的权限也要取回 id
    const existing = await this.db.select().from(permissions);
    for (const p of existing) permIdByCode.set(p.code, p.id);

    // 角色
    for (const [code, name] of Object.entries(ADMIN_ROLES)) {
      const roleRows = await this.db
        .insert(roles)
        .values({ code, name })
        .onConflictDoNothing({ target: roles.code })
        .returning();
      if (roleRows.length === 0) continue;
      const roleId = roleRows[0]!.id;
      const perms = DEFAULT_ROLE_PERMISSIONS[code as AdminRole] ?? [];
      if (perms.length === 0) continue;
      await this.db
        .insert(rolePermissions)
        .values(
          perms
            .map((p) => permIdByCode.get(p))
            .filter((pid): pid is string => Boolean(pid))
            .map((permissionId) => ({ roleId, permissionId })),
        )
        .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permissionId] });
    }
  }

  /** 解析用户权限集合（通过角色关联）。 */
  async permissionsForUser(userId: string): Promise<Set<Permission>> {
    const assignments = await this.db
      .select({ roleId: userRoleAssignments.roleId })
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.userId, userId));
    if (assignments.length === 0) return new Set();

    const rolePerms = await this.db
      .select({
        code: permissions.code,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, assignments.map((a) => a.roleId)));

    return new Set(rolePerms.map((r) => r.code as Permission));
  }

  /** 用户是否拥有某权限。 */
  async hasPermission(userId: string, permission: Permission): Promise<boolean> {
    const perms = await this.permissionsForUser(userId);
    return perms.has(permission);
  }

  /** 校验权限，不足时抛 PermissionDeniedError。 */
  async requirePermission(userId: string, permission: Permission): Promise<void> {
    if (!(await this.hasPermission(userId, permission))) {
      throw new PermissionDeniedError(permission, userId);
    }
  }

  /** 获取用户已分配的角色 code。 */
  async rolesForUser(userId: string): Promise<AdminRole[]> {
    const assignments = await this.db
      .select({ roleId: userRoleAssignments.roleId })
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.userId, userId));
    if (assignments.length === 0) return [];
    const roleRows = await this.db
      .select({ code: roles.code })
      .from(roles)
      .where(inArray(roles.id, assignments.map((a) => a.roleId)));
    return roleRows.map((r) => r.code as AdminRole);
  }

  /** 列出所有角色。 */
  async listRoles(): Promise<{ code: string; name: string }[]> {
    return this.db.select({ code: roles.code, name: roles.name }).from(roles);
  }

  /** 分配角色（幂等）。 */
  async assignRole(userId: string, roleCode: AdminRole, assignedBy?: string): Promise<void> {
    const roleRows = await this.db.select().from(roles).where(eq(roles.code, roleCode)).limit(1);
    const role = roleRows[0];
    if (!role) throw new Error(`ROLE_NOT_FOUND: ${roleCode}`);
    await this.db
      .insert(userRoleAssignments)
      .values({ userId, roleId: role.id, assignedBy })
      .onConflictDoNothing({ target: [userRoleAssignments.userId, userRoleAssignments.roleId] });
  }

  /** 撤销角色。 */
  async removeRole(userId: string, roleCode: AdminRole): Promise<void> {
    const roleRows = await this.db.select().from(roles).where(eq(roles.code, roleCode)).limit(1);
    const role = roleRows[0];
    if (!role) return;
    await this.db
      .delete(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, userId), eq(userRoleAssignments.roleId, role.id)));
  }

  /**
   * 高危操作：先做权限校验，再可选 step-up 复核，最后写 sensitive_action_logs。
   * stepUpVerifier 未配置时，敏感操作仅记录 stepUpMethod=NONE（审计但不强制额外验证）。
   */
  async guardSensitiveAction(params: {
    userId: string;
    permission: Permission;
    target?: string;
    reason?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    requestId?: string;
    stepUp?: StepUpVerifier;
    stepUpMethod?: StepUpMethod;
  }): Promise<{ stepUpMethod: StepUpMethod }> {
    await this.requirePermission(params.userId, params.permission);

    let method: StepUpMethod = params.stepUpMethod ?? 'NONE';
    if (params.stepUp) {
      const res = await params.stepUp.verify({
        userId: params.userId,
        permission: params.permission,
        method,
      });
      if (!res.ok) throw new StepUpRequiredError(params.permission);
      method = res.method;
    }

    await this.db.insert(sensitiveActionLogs).values({
      actorUserId: params.userId,
      permission: params.permission,
      target: params.target,
      reason: params.reason,
      before: params.before,
      after: params.after,
      requestId: params.requestId,
      stepUpMethod: method,
    });

    return { stepUpMethod: method };
  }
}