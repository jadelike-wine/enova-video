import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { PricingService } from './pricing.service.js';
import { SubscriptionFulfillmentService } from './subscription-fulfillment.service.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [],
  controllers: [BillingController],
  providers: [PricingService, WalletService, SubscriptionFulfillmentService],
  exports: [PricingService, WalletService, SubscriptionFulfillmentService],
})
export class BillingModule {}