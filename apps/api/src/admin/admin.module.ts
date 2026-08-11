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

@Module({
  imports: [BillingModule],
  controllers: [
    ProvidersAdminController,
    CredentialsAdminController,
    UsersAdminController,
    AuditAdminController,
    StatsAdminController,
  ],
  providers: [
    AdminGuard,
    AdminBootstrapService,
    AdminAuditService,
    ProvidersAdminService,
    CredentialsAdminService,
    UsersAdminService,
    StatsAdminService,
  ],
})
export class AdminModule {}