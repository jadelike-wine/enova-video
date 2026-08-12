import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { PricingService } from './pricing.service.js';
import { SubscriptionFulfillmentService } from './subscription-fulfillment.service.js';
import { WalletService } from './wallet.service.js';
import { BillingReconciliationService } from './billing-reconciliation.service.js';

@Module({
  imports: [],
  controllers: [BillingController],
  providers: [
    PricingService,
    WalletService,
    SubscriptionFulfillmentService,
    // P0-5: 注册 billing reconciliation，使 onModuleInit 周期核对 wallet <-> reservation
    // 不变量真正运行（此前该服务存在但未注册，永远不会执行）。
    BillingReconciliationService,
  ],
  exports: [PricingService, WalletService, SubscriptionFulfillmentService],
})
export class BillingModule {}