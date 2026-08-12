import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { GenerationsController } from './generations.controller.js';
import { GenerationsService } from './generations.service.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';

@Module({
  imports: [BillingModule],
  controllers: [GenerationsController],
  providers: [GenerationsService, OutboxDispatcher],
  exports: [GenerationsService, OutboxDispatcher],
})
export class GenerationsModule {}