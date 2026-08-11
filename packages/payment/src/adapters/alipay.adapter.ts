import { domainError, ERROR_CODES } from '@enova/contracts';
import type { AlipayConfig } from '../payment.types.js';
import type { PaymentProvider } from '../payment.types.js';

/**
 * 支付宝适配器（真实渠道）。
 * 本地无法端到端验签（需商户号 + 密钥），因此未配置完整商户参数时抛出
 * PAYMENT_CHANNEL_NOT_CONFIGURED；配置齐全后还需在服务端接入 RSA2 签名与网关调用，
 * 本适配器保留接口契约，作为真实接入的挂载点。
 */
export class AlipayPaymentProvider implements PaymentProvider {
  readonly key = 'alipay' as const;
  readonly name = 'Alipay';

  constructor(private readonly config: AlipayConfig | null) {}

  private requireConfig() {
    if (!this.config || !this.config.appId || !this.config.privateKey || !this.config.publicKey) {
      throw domainError(
        ERROR_CODES.PAYMENT_CHANNEL_NOT_CONFIGURED,
        'Alipay real channel requires merchant credentials (ALIPAY_* env)',
        400,
      );
    }
    return this.config;
  }

  async createPayment(): Promise<never> {
    this.requireConfig();
    throw domainError(
      ERROR_CODES.PAYMENT_CALLBACK_INVALID,
      'Alipay gateway integration requires server-side RSA2 signing which is not available in this build; use sandbox mode for local demo',
      501,
    );
  }

  async verifyNotification(): Promise<never> {
    this.requireConfig();
    throw domainError(
      ERROR_CODES.PAYMENT_CALLBACK_INVALID,
      'Alipay callback verification not available in this build; use sandbox mode for local demo',
      501,
    );
  }
}