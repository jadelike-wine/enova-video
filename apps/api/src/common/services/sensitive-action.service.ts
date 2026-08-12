import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { RbacStore } from '@enova/billing';
import { users, type Database } from '@enova/db';
import { domainError, ERROR_CODES, type Permission } from '@enova/contracts';
import { DATABASE } from '../../database/database.module.js';
import { PasswordService } from '../../auth/password.service.js';

export interface SensitiveActionResult {
  stepUpMethod: string;
  audited: boolean;
}

/**
 * P1.5: Sensitive action service.
 *
 * Wraps RbacStore.guardSensitiveAction with password-based step-up verification.
 * High-risk endpoints call this to enforce step-up and write audit logs.
 *
 * Flow:
 * 1. Verify step-up password (fail-closed: no password → reject)
 * 2. Call RbacStore.guardSensitiveAction (checks permission + writes audit)
 *
 * `guardSensitiveAction` 内部会再次 requirePermission（与 PermissionGuard 重复但无害），
 * 并把记录写入 sensitive_action_logs（与 AdminAuditService 写入的 admin_audit_logs 是两张
 * 不同的表：前者是安全审计，后者是操作历史）。我们不向 guardSensitiveAction 传 stepUp
 * 验证器——密码校验由本服务在前置完成，仅传 stepUpMethod='PASSWORD' 以便审计落库。
 */
@Injectable()
export class SensitiveActionService {
  constructor(
    @Inject(RbacStore) private readonly rbac: RbacStore,
    @Inject(DATABASE) private readonly db: Database,
    private readonly password: PasswordService,
  ) {}

  async execute(params: {
    actorUserId: string;
    permission: Permission;
    target?: string;
    reason?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    requestId?: string;
    stepUpPassword?: string;
  }): Promise<SensitiveActionResult> {
    // 1. Verify step-up password (fail-closed)
    if (!params.stepUpPassword) {
      throw domainError(ERROR_CODES.FORBIDDEN, 'Step-up password required for this action', 403, {
        stepUpRequired: true,
        method: 'PASSWORD',
      });
    }

    const userRows = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, params.actorUserId))
      .limit(1);
    const userHash = userRows[0]?.passwordHash;
    if (!userHash) {
      throw domainError(ERROR_CODES.FORBIDDEN, 'Unable to verify step-up: user not found', 403);
    }

    const passwordValid = await this.password.verify(params.stepUpPassword, userHash);
    if (!passwordValid) {
      throw domainError(ERROR_CODES.FORBIDDEN, 'Step-up password incorrect', 403, {
        stepUpRequired: true,
        method: 'PASSWORD',
      });
    }

    // 2. Check permission + write audit log (stepUpMethod=PASSWORD since we verified above)
    await this.rbac.guardSensitiveAction({
      userId: params.actorUserId,
      permission: params.permission,
      target: params.target,
      reason: params.reason,
      before: params.before,
      after: params.after,
      requestId: params.requestId,
      stepUpMethod: 'PASSWORD',
    });

    return { stepUpMethod: 'PASSWORD', audited: true };
  }
}
