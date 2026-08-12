import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { USER_ROLES, ADMIN_ROLES } from '@enova/contracts';
import { RbacStore } from '@enova/billing';
import { users, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Admin Bootstrap (P1.5):
 * 1. 幂等预置内建 RBAC 角色、权限与角色-权限映射。
 * 2. 将所有 legacy role='ADMIN' 用户自动迁移为 SUPER_ADMIN RBAC role。
 * 3. 若配置了 auth.initialAdminEmail 且用户存在，确保其拥有 ADMIN role（DB 字段）
 *    并分配 SUPER_ADMIN RBAC role。
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RbacStore) private readonly rbacStore: RbacStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // 1. Seed RBAC roles/permissions (idempotent)
    await this.rbacStore.seed();

    // 2. Migrate legacy ADMIN users → SUPER_ADMIN RBAC role
    const adminUsers = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.role, USER_ROLES.ADMIN));

    for (const admin of adminUsers) {
      // assignedBy 是 UUID 外键（users.id），传非 UUID 会导致 PG 报错。
      // 系统自动迁移不记录操作人，留 NULL 即可。
      await this.rbacStore.assignRole(admin.id, ADMIN_ROLES.SUPER_ADMIN);
    }

    if (adminUsers.length > 0) {
      this.logger.log(`Migrated ${adminUsers.length} legacy ADMIN user(s) to SUPER_ADMIN RBAC role`);
    }

    // 3. Handle initialAdminEmail setting
    const email = (await this.settings.getString('auth.initialAdminEmail'))?.trim().toLowerCase();
    if (!email) return;

    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user) return;

    // Ensure both legacy DB field and RBAC role are set
    if (user.role !== USER_ROLES.ADMIN) {
      await this.db
        .update(users)
        .set({ role: USER_ROLES.ADMIN, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    // Always ensure RBAC SUPER_ADMIN role (idempotent)
    await this.rbacStore.assignRole(user.id, ADMIN_ROLES.SUPER_ADMIN);
  }
}
