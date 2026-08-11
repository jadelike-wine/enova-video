import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { AdminGuard } from './admin.guard.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { ProvidersAdminService } from './providers.admin.service.js';
import { CredentialsAdminService } from './credentials.admin.service.js';
import { UsersAdminService } from './users.admin.service.js';
import { StatsAdminService } from './stats.admin.service.js';
import { ProvidersAdminController } from './providers.admin.controller.js';
import { CredentialsAdminController } from './credentials.admin.controller.js';
import { UsersAdminController } from './users.admin.controller.js';
import { AuditAdminController } from './audit.admin.controller.js';
import { StatsAdminController } from './stats.admin.controller.js';
import { SettingsAdminController } from './settings.admin.controller.js';
import { SettingsAdminService } from './settings.admin.service.js';
import { SystemUpdateController } from './system-update/system-update.controller.js';
import { SystemUpdateService } from './system-update/system-update.service.js';
import { GitHubReleaseClient } from './system-update/github-client.service.js';
import { RedisStore } from './system-update/redis-store.service.js';
import { DeployExecutor } from './system-update/deploy-executor.service.js';
import {
  SYSTEM_UPDATE_REDIS,
  SystemUpdateRedisShutdown,
  createSystemUpdateRedis,
} from './system-update/system-update.redis.js';
import { ENV } from '../config/config.module.js';

@Module({
  imports: [BillingModule],
  controllers: [
    ProvidersAdminController,
    CredentialsAdminController,
    UsersAdminController,
    AuditAdminController,
    StatsAdminController,
    SettingsAdminController,
    SystemUpdateController,
  ],
  providers: [
    AdminGuard,
    AdminBootstrapService,
    AdminAuditService,
    ProvidersAdminService,
    CredentialsAdminService,
    UsersAdminService,
    StatsAdminService,
    SettingsAdminService,
    SystemUpdateRedisShutdown,
    { provide: SYSTEM_UPDATE_REDIS, inject: [ENV], useFactory: createSystemUpdateRedis },
    GitHubReleaseClient,
    RedisStore,
    DeployExecutor,
    SystemUpdateService,
  ],
})
export class AdminModule {}