import { domainError, ERROR_CODES } from '@enova/contracts';
import type { PaymentProvider, PaymentProviderKey } from './payment.types.js';

/**
 * 支付渠道注册表。
 * 各渠道适配器按 key 注册，调用方按需取用；未注册的渠道抛出 PAYMENT_CHANNEL_NOT_CONFIGURED。
 * 不含 NestJS 依赖，可在 API 内直接实例化并注入。
 */
export class PaymentRegistry {
  private readonly providers = new Map<PaymentProviderKey, PaymentProvider>();

  register(provider: PaymentProvider): this {
    this.providers.set(provider.key, provider);
    return this;
  }

  has(key: PaymentProviderKey): boolean {
    return this.providers.has(key);
  }

  get(key: PaymentProviderKey): PaymentProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw domainError(
        ERROR_CODES.PAYMENT_CHANNEL_NOT_CONFIGURED,
        `Payment channel not configured or not registered: ${key}`,
        400,
      );
    }
    return provider;
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}