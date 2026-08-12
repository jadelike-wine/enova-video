import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { orders, paymentTransactions, plans, wallets, type Database } from '@enova/db';
import {
  buildPaymentRegistry,
  creditsFromCents,
  PaymentRegistry,
  type PaymentEnvConfig,
  type PaymentNotification,
  type PaymentProvider,
  type PaymentProviderKey,
} from '@enova/payment';
import type { AuthUser } from '../auth/auth.service.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { SubscriptionFulfillmentService } from '../billing/subscription-fulfillment.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { CostRevenueLedger, CouponService, generateRevenueEventKey } from '@enova/billing';

export interface RechargeResult {
  orderId: string;
  amountCents: number;
  credits: number;
  channel: PaymentProviderKey;
  tradeNo?: string;
  payUrl?: string;
  qrCode?: string;
  /** P1-8: 实际折扣金额（分），无优惠码时为 0。 */
  discountAmountCents: number;
  couponCode: string | null;
}

/**
 * 充值支付服务（Phase 7）。
 * - 下单：金额（分）→ credits 换算 → 创建 PENDING 订单 → 调渠道下单 → 记交易单。
 * - 回调：渠道验签 → 幂等入账（订单行锁 + wallet RECHARGE 幂等键双重保护）。
 * - sandbox：提供模拟确认端点，本地演示无需商户密钥。
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(SubscriptionFulfillmentService) private readonly fulfillment: SubscriptionFulfillmentService,
  ) {}

  /**
   * 从动态配置构建支付渠道 registry（每次下单实时读取，后台改支付参数立即生效）。
   * 商户密钥等敏感项从 settings 解密获取；未配置时走 sandbox 兜底。
   */
  private async buildConfig(): Promise<{
    registry: PaymentRegistry;
    activeProvider: PaymentProviderKey;
    notifyUrl: string;
    returnBaseUrl: string;
  }> {
    const mode = ((await this.settings.getString('payment.mode')) ?? 'sandbox') as PaymentEnvConfig['mode'];
    const creditsPerCny = (await this.settings.getNumber('payment.creditsPerCny')) ?? 100;
    const minRechargeCents = (await this.settings.getNumber('payment.minRechargeCents')) ?? 100;
    const returnBaseUrl = (await this.settings.getString('payment.returnBaseUrl')) ?? 'http://localhost:3001';
    const notifyUrl = (await this.settings.getString('payment.notifyUrl')) ?? 'http://localhost:3001/api/v1/payment/notify';

    const alipayAppId = await this.settings.getString('payment.alipayAppId');
    const alipayPrivateKey = await this.settings.getString('payment.alipayPrivateKey');
    const alipayPublicKey = await this.settings.getString('payment.alipayPublicKey');
    const alipayGateway = (await this.settings.getString('payment.alipayGateway')) ?? 'https://openapi.alipay.com/gateway.do';
    const wechatAppId = await this.settings.getString('payment.wechatAppId');
    const wechatMchId = await this.settings.getString('payment.wechatMchId');
    const wechatApiV3Key = await this.settings.getString('payment.wechatApiV3Key');
    const wechatSerialNo = await this.settings.getString('payment.wechatSerialNo');
    const wechatPrivateKey = await this.settings.getString('payment.wechatPrivateKey');
    const wechatPlatformCert = await this.settings.getString('payment.wechatPlatformCert');

    const cfg: PaymentEnvConfig = {
      mode,
      creditsPerCny,
      minRechargeCents,
      returnBaseUrl,
      notifyUrl,
      alipay:
        alipayAppId && alipayPrivateKey && alipayPublicKey
          ? { appId: alipayAppId, privateKey: alipayPrivateKey, publicKey: alipayPublicKey, gateway: alipayGateway }
          : undefined,
      wechat:
        wechatAppId && wechatMchId && wechatApiV3Key && wechatSerialNo && wechatPrivateKey
          ? {
              appId: wechatAppId,
              mchId: wechatMchId,
              apiV3Key: wechatApiV3Key,
              serialNo: wechatSerialNo,
              privateKey: wechatPrivateKey,
              platformCert: wechatPlatformCert ?? undefined,
            }
          : undefined,
    };
    const built = buildPaymentRegistry(cfg);
    return {
      registry: built.registry,
      activeProvider: built.activeProvider,
      notifyUrl,
      returnBaseUrl,
    };
  }

  /** 创建充值订单并调渠道下单。couponCode 可选（P1-8 优惠码）。 */
  async createRecharge(user: AuthUser, amountCents: number, couponCode?: string): Promise<RechargeResult> {
    const { registry, activeProvider, notifyUrl, returnBaseUrl } = await this.buildConfig();
    const minRechargeCents = (await this.settings.getNumber('payment.minRechargeCents')) ?? 0;
    const creditsPerCny = (await this.settings.getNumber('payment.creditsPerCny')) ?? 0;
    if (amountCents < minRechargeCents) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Recharge amount below minimum of ${minRechargeCents} cents`, 400, {
        min: minRechargeCents,
      });
    }

    const provider: PaymentProvider = registry.get(activeProvider);
    const orderId = randomUUID();
    const subject = `充值 credits`;

    // P1-8: 事务内原子地"锁 coupon + 校验 + 写兑换 + 建订单"，并发安全。
    // finalAmountCents = 实际应付（扣除优惠后的金额），以它作为渠道支付金额与 credits 换算基准。
    let discountAmountCents = 0;
    let finalAmountCents = amountCents;
    let couponSnapshot: Record<string, unknown> | null = null;
    let credits = 0;
    await this.db.transaction(async (tx) => {
      if (couponCode) {
        const snap = await new CouponService(tx).apply(couponCode, {
          amountCents,
          currency: 'CNY',
          userId: user.userId,
          orderId,
        });
        couponSnapshot = snap as unknown as Record<string, unknown>;
        discountAmountCents = snap.discountAmountCents;
        finalAmountCents = snap.finalAmountCents;
      }
      credits = creditsFromCents(finalAmountCents, creditsPerCny);
      if (credits <= 0) {
        throw domainError(ERROR_CODES.PAYMENT_CREDITS_NOT_POSITIVE, 'Recharge credits must be positive', 400);
      }
      // P0-6: 订单快照——下单时的商品/价格/credits 不可变副本。
      const snapshot = {
        orderType: 'RECHARGE' as const,
        amountCents: finalAmountCents,
        originalAmountCents: amountCents,
        currency: 'CNY',
        credits,
        creditsPerCny,
        subject,
        createdAt: new Date().toISOString(),
      };
      await tx.insert(orders).values({
        id: orderId,
        workspaceId: user.workspaceId,
        userId: user.userId,
        orderType: 'RECHARGE',
        amountCents: finalAmountCents,
        currency: 'CNY',
        credits,
        snapshotJson: snapshot,
        couponCode: couponCode ?? null,
        couponSnapshotJson: couponSnapshot,
        originalAmountCents: amountCents,
        discountAmountCents,
        finalAmountCents,
        status: 'PENDING',
        fulfillmentStatus: 'PENDING',
      });
    });

    const chargedByProvider = await provider.createPayment({
      orderId,
      amountCents: finalAmountCents,
      subject,
      notifyUrl,
      returnUrl: `${returnBaseUrl}/payment/result?orderId=${orderId}`,
    });

    await this.db.insert(paymentTransactions).values({
      orderId,
      provider: activeProvider,
      providerRef: chargedByProvider.tradeNo,
      status: 'PENDING',
    });

    return {
      orderId,
      amountCents: finalAmountCents,
      credits,
      channel: activeProvider,
      tradeNo: chargedByProvider.tradeNo,
      payUrl: chargedByProvider.payUrl,
      qrCode: chargedByProvider.qrCode,
      discountAmountCents,
      couponCode: couponCode ?? null,
    };
  }

  /** P0-3: 列出可售卖的 Plan（enabled=true）。 */
  async listPurchasablePlans(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.db
      .select()
      .from(plans)
      .where(eq(plans.enabled, true))
      .orderBy(plans.priceCents);
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      monthlyCredits: p.monthlyCredits,
      priceCents: p.priceCents,
      currency: p.currency,
      periodDays: p.periodDays,
      oneTime: p.oneTime,
      entitlements: {
        maxConcurrentGenerations: p.maxConcurrentGenerations,
        maxResolution: p.maxResolution,
        maxDurationSeconds: p.maxDurationSeconds,
        storageRetentionDays: p.storageRetentionDays,
        priority: p.priority,
        watermark: p.watermark,
        commercialUse: p.commercialUse,
        allowedModels: p.allowedModels ?? null,
      },
    }));
  }

  /**
   * P0-3: 创建打包/订阅订单（PLAN）。
   *
   * 关键点：下单时把 plan 的商品/价格/credits/entitlements 冻结进订单快照 snapshotJson，
   * 后续即使管理员改价，履约也按快照（历史成交）执行，绝不能用当前 plan 配置覆盖历史成交。
   */
  async createPlanOrder(user: AuthUser, planId: string, couponCode?: string): Promise<RechargeResult> {
    const { registry, activeProvider, notifyUrl, returnBaseUrl } = await this.buildConfig();
    const planRows = await this.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    const plan = planRows[0];
    if (!plan) throw domainError(ERROR_CODES.NOT_FOUND, 'Plan not found', 404);
    if (!plan.enabled) throw domainError(ERROR_CODES.VALIDATION_ERROR, 'Plan is not for sale', 403);

    const provider: PaymentProvider = registry.get(activeProvider);
    const orderId = randomUUID();
    const subject = `购买 ${plan.name}`;

    // P1-8: 事务内原子地"锁 coupon + 校验 + 写兑换 + 建订单"，并发安全。
    let discountAmountCents = 0;
    let finalAmountCents = plan.priceCents;
    let couponSnapshot: Record<string, unknown> | null = null;
    await this.db.transaction(async (tx) => {
      if (couponCode) {
        const snap = await new CouponService(tx).apply(couponCode, {
          amountCents: plan.priceCents,
          currency: plan.currency,
          userId: user.userId,
          orderId,
        });
        couponSnapshot = snap as unknown as Record<string, unknown>;
        discountAmountCents = snap.discountAmountCents;
        finalAmountCents = snap.finalAmountCents;
      }
      // 冻结下单时的商品快照（历史成交解释依据）。
      const snapshot = {
        orderType: 'PLAN' as const,
        planId: plan.id,
        planCode: plan.code,
        planName: plan.name,
        monthlyCredits: plan.monthlyCredits,
        periodDays: plan.periodDays,
        priceCents: plan.priceCents,
        finalAmountCents,
        currency: plan.currency,
        oneTime: plan.oneTime,
        entitlements: {
          monthlyCredits: plan.monthlyCredits,
          periodDays: plan.periodDays,
          maxConcurrentGenerations: plan.maxConcurrentGenerations,
          maxResolution: plan.maxResolution,
          maxDurationSeconds: plan.maxDurationSeconds,
          storageRetentionDays: plan.storageRetentionDays,
          priority: plan.priority,
          watermark: plan.watermark,
          commercialUse: plan.commercialUse,
          allowedModels: plan.allowedModels ?? null,
        },
        subject,
        createdAt: new Date().toISOString(),
      };
      await tx.insert(orders).values({
        id: orderId,
        workspaceId: user.workspaceId,
        userId: user.userId,
        orderType: 'PLAN',
        planId: plan.id,
        amountCents: finalAmountCents,
        currency: plan.currency,
        credits: plan.monthlyCredits,
        snapshotJson: snapshot,
        couponCode: couponCode ?? null,
        couponSnapshotJson: couponSnapshot,
        originalAmountCents: plan.priceCents,
        discountAmountCents,
        finalAmountCents,
        status: 'PENDING',
        fulfillmentStatus: 'PENDING',
      });
    });

    const chargedByProvider = await provider.createPayment({
      orderId,
      amountCents: finalAmountCents,
      subject,
      notifyUrl,
      returnUrl: `${returnBaseUrl}/payment/result?orderId=${orderId}`,
    });

    await this.db.insert(paymentTransactions).values({
      orderId,
      provider: activeProvider,
      providerRef: chargedByProvider.tradeNo,
      status: 'PENDING',
    });

    return {
      orderId,
      amountCents: finalAmountCents,
      credits: plan.monthlyCredits,
      channel: activeProvider,
      tradeNo: chargedByProvider.tradeNo,
      payUrl: chargedByProvider.payUrl,
      qrCode: chargedByProvider.qrCode,
      discountAmountCents,
      couponCode: couponCode ?? null,
    };
  }

  /** 渠道异步通知入口：验签后幂等入账。返回 received=false 表示无关回调（应返回 200 忽略）。 */
  async notify(providerKey: PaymentProviderKey, rawBody: string, headers: Record<string, string>): Promise<{ received: boolean }> {
    const { registry } = await this.buildConfig();
    const provider = registry.get(providerKey);
    const notification: PaymentNotification | null = await provider.verifyNotification(rawBody, headers);
    if (!notification) return { received: false };
    if (notification.status === 'success') {
      await this.settleNotification(notification);
    }
    return { received: true };
  }

  /** sandbox：模拟确认支付（仅当前 Workspace 可确权自己的订单）。 */
  async simulateConfirm(user: AuthUser, orderId: string): Promise<{ orderId: string; credits: number; balance: number }> {
    const order = await this.requireOrderForWorkspace(orderId, user.workspaceId);
    await this.settleOrder(order.workspaceId, order.id, order.credits);
    const w = await this.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.workspaceId, order.workspaceId))
      .limit(1);
    return { orderId: order.id, credits: order.credits, balance: w[0]?.balance ?? 0 };
  }

  private async settleNotification(notification: PaymentNotification): Promise<void> {
    const order = await this.requireOrder(notification.orderId);
    // P0-6: 金额校验（防少付）。
    if (order.amountCents !== notification.amountCents) {
      throw domainError(ERROR_CODES.PAYMENT_AMOUNT_MISMATCH, 'Payment amount mismatch with order', 400, {
        order: order.amountCents,
        paid: notification.amountCents,
      });
    }
    // P0-6: 货币校验（订单 currency 与渠道默认 CNY 一致；未来支持多币种时扩展）。
    if (order.currency !== 'CNY') {
      throw domainError(ERROR_CODES.PAYMENT_AMOUNT_MISMATCH, `Unsupported currency: ${order.currency}`, 400);
    }
    // P0-6: 回写真实第三方交易号（下单时可能是占位 orderId，回调拿到真实 trade_no/transaction_id）。
    // provider_ref 唯一索引保证同一渠道交易号不重复入账（防重复回调）。
    // 若出现唯一约束冲突（同一 trade_no 已被另一订单占用），必须 fail-closed，禁止继续入账。
    if (notification.tradeNo && notification.tradeNo !== order.id) {
      try {
        await this.db
          .update(paymentTransactions)
          .set({ providerRef: notification.tradeNo, status: 'SUCCEEDED', updatedAt: new Date() })
          .where(
            and(
              eq(paymentTransactions.orderId, order.id),
              eq(paymentTransactions.status, 'PENDING'),
            ),
          );
      } catch {
        // provider_ref 唯一约束冲突：同一交易号已被另一订单入账（跨订单 replayed webhook）。
        // 这是重复/篡改入账的强信号，绝不能静默吞掉后继续 recharge。
        throw domainError(
          ERROR_CODES.PAYMENT_TX_REF_CONFLICT,
          'Payment transaction ref already bound to another order',
          409,
          { orderId: order.id, tradeNo: notification.tradeNo },
        );
      }
    }
    await this.settleOrder(order.workspaceId, order.id, order.credits);
  }

  private async settleOrder(workspaceId: string, orderId: string, credits: number): Promise<void> {
    await this.markSucceededAndRecharge(workspaceId, orderId, credits);
    // P0-7: PLAN 订单支付成功后触发订阅履约（创建 subscription + 发放 credits）。
    // 履约幂等（idempotency_key = orderId），失败不回滚支付，由 reconciliation 补偿。
    try {
      const order = await this.requireOrder(orderId);
      if (order.orderType === 'PLAN' && order.fulfillmentStatus === 'PENDING') {
        await this.fulfillment.fulfill(orderId);
      }
    } catch {
      // 履约失败不阻断 webhook 返回（已入账），由 reconciliation 补偿。
    }
  }

  /**
   * 入账核心：事务内锁定订单 → 校验 PENDING → 置 SUCCEEDED → 更新交易单 → 调用
   * WalletGateway.rechargeInTx 写入 RECHARGE（幂等键防重复）。订单行锁保证并发回调串行化。
   *
   * P0-6/P0-7: RECHARGE 订单的 fulfillment = recharge 本身，直接标记 SUCCEEDED。
   * PLAN/CREDIT_PACK 订单的 fulfillment 由 SubscriptionFulfillmentService 处理，此处只标记 payment SUCCEEDED。
   */
  private async markSucceededAndRecharge(workspaceId: string, orderId: string, credits: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      const order = rows[0];
      if (!order) throw domainError(ERROR_CODES.PAYMENT_NOT_FOUND, 'Order not found', 404);
      if (order.status === 'SUCCEEDED') return; // 幂等：已入账
      if (order.status !== 'PENDING') {
        throw domainError(ERROR_CODES.PAYMENT_ORDER_NOT_PENDING, `Order is not pending (${order.status})`, 409);
      }

      // RECHARGE / CREDIT_PACK：recharge 即 fulfillment，同事务完成。
      // PLAN：payment 成功后由 SubscriptionFulfillmentService 异步履约，此处只标 payment SUCCEEDED。
      const isRechargeLike = order.orderType === 'RECHARGE' || order.orderType === 'CREDIT_PACK';
      await tx
        .update(orders)
        .set({
          status: 'SUCCEEDED',
          fulfillmentStatus: isRechargeLike ? 'SUCCEEDED' : 'PENDING',
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
      await tx.update(paymentTransactions).set({ status: 'SUCCEEDED', updatedAt: new Date() }).where(eq(paymentTransactions.orderId, orderId));

      if (isRechargeLike) {
        await this.wallet.rechargeInTx(tx, workspaceId, credits, orderId, `payment:recharge:${orderId}`);
      }

      // P1-1: 订单支付成功 → 写 append-only revenue event（eventKey=orderId 幂等）。
      // 收入确认与支付原子，防止重复入账。PLAN 收入在支付时确认（履约由 fulfillment 负责）。
      const ledger = new CostRevenueLedger(tx);
      await ledger.insertRevenueEvent({
        eventKey: generateRevenueEventKey(order.id),
        workspaceId: order.workspaceId,
        userId: order.userId,
        orderId: order.id,
        revenueType:
          order.orderType === 'PLAN' ? 'PLAN' : order.orderType === 'CREDIT_PACK' ? 'CREDIT_PACK' : 'RECHARGE',
        currency: order.currency,
        grossAmountCents: order.amountCents,
        recognizedAmountCents: order.finalAmountCents ?? order.amountCents,
        metadata: { orderType: order.orderType },
      });
    });
  }

  private async requireOrder(orderId: string) {
    const rows = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = rows[0];
    if (!order) throw domainError(ERROR_CODES.PAYMENT_NOT_FOUND, 'Order not found', 404);
    return order;
  }

  private async requireOrderForWorkspace(orderId: string, workspaceId: string) {
    const rows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    const order = rows[0];
    if (!order) throw domainError(ERROR_CODES.PAYMENT_NOT_FOUND, 'Order not found', 404);
    if (order.workspaceId !== workspaceId) {
      throw domainError(ERROR_CODES.IDOR_FORBIDDEN, 'Order does not belong to this workspace', 403);
    }
    return order;
  }

  // ---- P0-6: query / close（生产就绪支付契约）。产品策略：不支持自动退款。 ----

  /** 查询渠道订单状态（对账用）。 */
  async queryPayment(orderId: string): Promise<{
    orderId: string;
    status: string;
    channelStatus: string;
    amountCents: number;
    tradeNo: string;
  }> {
    const order = await this.requireOrder(orderId);
    const txRows = await this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, orderId))
      .limit(1);
    const tx = txRows[0];
    if (!tx) throw domainError(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment transaction not found', 404);

    const { registry } = await this.buildConfig();
    const provider = registry.get(tx.provider as PaymentProviderKey);
    const result = await provider.queryPayment(tx.providerRef ?? orderId, orderId);

    return {
      orderId,
      status: order.status,
      channelStatus: result.status,
      amountCents: result.amountCents,
      tradeNo: result.tradeNo ?? tx.providerRef ?? orderId,
    };
  }

  /** 关闭未支付订单（防止用户长期挂单）。 */
  async closePayment(orderId: string): Promise<void> {
    const order = await this.requireOrder(orderId);
    if (order.status !== 'PENDING') {
      throw domainError(ERROR_CODES.PAYMENT_ORDER_NOT_PENDING, `Cannot close order in status ${order.status}`, 409);
    }
    const txRows = await this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, orderId))
      .limit(1);
    const tx = txRows[0];
    if (!tx) return;

    const { registry } = await this.buildConfig();
    const provider = registry.get(tx.provider as PaymentProviderKey);
    try {
      await provider.closePayment(orderId);
    } catch {
      // 渠道关单失败不阻断本地关闭（订单可能已被渠道自动关闭）。
    }

    await this.db
      .update(orders)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }
}