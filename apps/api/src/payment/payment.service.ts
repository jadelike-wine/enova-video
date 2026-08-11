import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { orders, paymentTransactions, wallets, type Database } from '@enova/db';
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
import { WalletService } from '../billing/wallet.service.js';

export interface RechargeResult {
  orderId: string;
  amountCents: number;
  credits: number;
  channel: PaymentProviderKey;
  tradeNo?: string;
  payUrl?: string;
  qrCode?: string;
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

  /** 创建充值订单并调渠道下单。 */
  async createRecharge(user: AuthUser, amountCents: number): Promise<RechargeResult> {
    const { registry, activeProvider, notifyUrl, returnBaseUrl } = await this.buildConfig();
    const minRechargeCents = (await this.settings.getNumber('payment.minRechargeCents')) ?? 0;
    const creditsPerCny = (await this.settings.getNumber('payment.creditsPerCny')) ?? 0;
    if (amountCents < minRechargeCents) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Recharge amount below minimum of ${minRechargeCents} cents`, 400, {
        min: minRechargeCents,
      });
    }
    const credits = creditsFromCents(amountCents, creditsPerCny);
    if (credits <= 0) {
      throw domainError(ERROR_CODES.PAYMENT_CREDITS_NOT_POSITIVE, 'Recharge credits must be positive', 400);
    }

    const provider: PaymentProvider = registry.get(activeProvider);
    const orderId = randomUUID();
    const subject = `充值 ${credits} credits`;

    await this.db.insert(orders).values({
      id: orderId,
      workspaceId: user.workspaceId,
      userId: user.userId,
      amountCents,
      credits,
      status: 'PENDING',
    });

    const created = await provider.createPayment({
      orderId,
      amountCents,
      subject,
      notifyUrl,
      returnUrl: `${returnBaseUrl}/payment/result?orderId=${orderId}`,
    });

    await this.db.insert(paymentTransactions).values({
      orderId,
      provider: activeProvider,
      providerRef: created.tradeNo,
      status: 'PENDING',
    });

    return {
      orderId,
      amountCents,
      credits,
      channel: activeProvider,
      tradeNo: created.tradeNo,
      payUrl: created.payUrl,
      qrCode: created.qrCode,
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
    if (order.amountCents !== notification.amountCents) {
      throw domainError(ERROR_CODES.PAYMENT_AMOUNT_MISMATCH, 'Payment amount mismatch with order', 400, {
        order: order.amountCents,
        paid: notification.amountCents,
      });
    }
    await this.settleOrder(order.workspaceId, order.id, order.credits);
  }

  private async settleOrder(workspaceId: string, orderId: string, credits: number): Promise<void> {
    await this.markSucceededAndRecharge(workspaceId, orderId, credits);
  }

  /**
   * 入账核心：事务内锁定订单 → 校验 PENDING → 置 SUCCEEDED → 更新交易单 → 调用
   * WalletGateway.rechargeInTx 写入 RECHARGE（幂等键防重复）。订单行锁保证并发回调串行化。
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

      await tx.update(orders).set({ status: 'SUCCEEDED', updatedAt: new Date() }).where(eq(orders.id, orderId));
      await tx.update(paymentTransactions).set({ status: 'SUCCEEDED', updatedAt: new Date() }).where(eq(paymentTransactions.orderId, orderId));
      await this.wallet.rechargeInTx(tx, workspaceId, credits, orderId, `payment:recharge:${orderId}`);
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
}