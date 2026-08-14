import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { GenerationsModule } from './generations/generations.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AdminModule } from './admin/admin.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SetupModule } from './setup/setup.module.js';
import { RequestIdMiddleware } from './common/request-id/request-id.middleware.js';
import { RateLimitModule } from './common/guards/rate-limit.module.js';
import { AccessLogMiddleware } from './common/access-log/access-log.middleware.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    BillingModule,
    GenerationsModule,
    QueueModule,
    AdminModule,
    PaymentModule,
    SettingsModule,
    SetupModule,
    RateLimitModule,
  ],
  providers: [AccessLogMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, AccessLogMiddleware).forRoutes('*');
  }
}
