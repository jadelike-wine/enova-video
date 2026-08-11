import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { GenerationsController } from './generations.controller.js';
import { GenerationsService } from './generations.service.js';

@Module({
  imports: [BillingModule],
  controllers: [GenerationsController],
  providers: [GenerationsService],
  exports: [GenerationsService],
})
export class GenerationsModule {}