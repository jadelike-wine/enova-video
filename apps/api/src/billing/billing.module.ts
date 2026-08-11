import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { PricingService } from './pricing.service.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [],
  controllers: [BillingController],
  providers: [PricingService, WalletService],
  exports: [PricingService, WalletService],
})
export class BillingModule {}