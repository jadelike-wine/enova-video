import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { USER_ROLES } from '@enova/contracts';
import { users, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';

/**
 * Admin Bootstrap：应用启动时，若配置了 INITIAL_ADMIN_EMAIL 且该用户已存在，
 * 将其提升为 ADMIN（幂等）。用于初始化首个管理员。
 * 用户尚未注册时跳过——注册流程（AuthService）会处理该邮箱直接授予 ADMIN 角色。
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    if (!email) return;

    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user) return; // 尚未注册，注册时由 AuthService 处理
    if (user.role === USER_ROLES.ADMIN) return;

    await this.db
      .update(users)
      .set({ role: USER_ROLES.ADMIN, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }
}