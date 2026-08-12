import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { AdminGuard } from './admin.guard.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { ProvidersAdminService } from './providers.admin.service.js';
import { CredentialsAdminService } from './credentials.admin.service.js';
import { UsersAdminService } from './users.admin.service.js';
import { StatsAdminService } from './stats.admin.service.js';
import { OrdersAdminService } from './orders.admin.service.js';
import { GenerationsAdminService } from './generations.admin.service.js';
import { PricingAdminService } from './pricing.admin.service.js';
import { CustomersAdminService } from './customers.admin.service.js';
import { ProvidersAdminController } from './providers.admin.controller.js';
import { CredentialsAdminController } from './credentials.admin.controller.js';
import { UsersAdminController } from './users.admin.controller.js';
import { AuditAdminController } from './audit.admin.controller.js';
import { StatsAdminController } from './stats.admin.controller.js';
import { SettingsAdminController } from './settings.admin.controller.js';
import { OrdersAdminController } from './orders.admin.controller.js';
import { GenerationsAdminController } from './generations.admin.controller.js';
import { PricingAdminController } from './pricing.admin.controller.js';
import { CustomersAdminController } from './customers.admin.controller.js';
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
  imports: [BillingModule, PaymentModule],
  controllers: [
    ProvidersAdminController,
    CredentialsAdminController,
    UsersAdminController,
    AuditAdminController,
    StatsAdminController,
    SettingsAdminController,
    OrdersAdminController,
    GenerationsAdminController,
    PricingAdminController,
    CustomersAdminController,
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
    OrdersAdminService,
    GenerationsAdminService,
    PricingAdminService,
    CustomersAdminService,
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