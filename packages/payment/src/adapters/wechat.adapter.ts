import { domainError, ERROR_CODES } from '@enova/contracts';
import type { PaymentProvider, WechatConfig } from '../payment.types.js';

/**
 * 微信支付（APIv3）适配器（真实渠道）。
 * 本地无法端到端验签（需商户号 + APIv3 密钥），因此未配置完整商户参数时抛出
 * PAYMENT_CHANNEL_NOT_CONFIGURED；配置齐全后还需在服务端接入 RSA 签名与网关调用，
 * 本适配器保留接口契约，作为真实接入的挂载点。
 */
export class WechatPaymentProvider implements PaymentProvider {
  readonly key = 'wechat' as const;
  readonly name = 'Wechat Pay';

  constructor(private readonly config: WechatConfig | null) {}

  private requireConfig() {
    if (
      !this.config ||
      !this.config.appId ||
      !this.config.mchId ||
      !this.config.apiV3Key ||
      !this.config.serialNo ||
      !this.config.privateKey
    ) {
      throw domainError(
        ERROR_CODES.PAYMENT_CHANNEL_NOT_CONFIGURED,
        'Wechat Pay real channel requires merchant credentials (WECHAT_* env)',
        400,
      );
    }
    return this.config;
  }

  async createPayment(): Promise<never> {
    this.requireConfig();
    throw domainError(
      ERROR_CODES.PAYMENT_CALLBACK_INVALID,
      'Wechat Pay gateway integration requires server-side signing which is not available in this build; use sandbox mode for local demo',
      501,
    );
  }

  async verifyNotification(): Promise<never> {
    this.requireConfig();
    throw domainError(
      ERROR_CODES.PAYMENT_CALLBACK_INVALID,
      'Wechat Pay callback verification not available in this build; use sandbox mode for local demo',
      501,
    );
  }
}