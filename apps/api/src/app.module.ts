import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { BillingModule } from './billing/billing.module.js';
import { GenerationsModule } from './generations/generations.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AdminModule } from './admin/admin.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { RequestIdMiddleware } from './common/request-id/request-id.middleware.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    ConversationsModule,
    BillingModule,
    GenerationsModule,
    QueueModule,
    AdminModule,
    PaymentModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}