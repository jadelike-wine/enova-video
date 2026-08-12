import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { PricingService } from './pricing.service.js';
import { SubscriptionFulfillmentService } from './subscription-fulfillment.service.js';
import { WalletService } from './wallet.service.js';
import { BillingReconciliationService } from './billing-reconciliation.service.js';
import { EntitlementService, RbacStore } from '@enova/billing';
import { DATABASE } from '../database/database.module.js';
import type { Database } from '@enova/db';

/**
 * P1-2: EntitlementService 需要 Database 实例，通过工厂注入。
 * 作为 provider 暴露，供 GenerationsService 在创建任务前做用户级限额检查。
 */
const EntitlementProvider = {
  provide: EntitlementService,
  inject: [DATABASE],
  useFactory: (db: Database) => new EntitlementService(db),
};

/**
 * P1-5: RbacStore 需要 Database 实例，通过工厂注入。
 * 作为 provider 暴露，供 PermissionGuard 与 Admin 模块做 RBAC 校验与 seed。
 */
const RbacStoreProvider = {
  provide: RbacStore,
  inject: [DATABASE],
  useFactory: (db: Database) => new RbacStore(db),
};

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
    // P1-2: 注册用户级限额服务。
    EntitlementProvider,
    // P1-5: 注册 RBAC store，供 PermissionGuard 与 admin seed 使用。
    RbacStoreProvider,
  ],
  exports: [PricingService, WalletService, SubscriptionFulfillmentService, EntitlementService, RbacStore],
})
export class BillingModule {}