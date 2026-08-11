import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';

@Module({
  imports: [BillingModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}