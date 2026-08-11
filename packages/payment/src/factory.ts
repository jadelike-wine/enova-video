import type { PaymentEnvConfig } from './payment.types.js';
import { PaymentRegistry } from './registry.js';
import { SandboxPaymentProvider } from './adapters/sandbox.adapter.js';
import { AlipayPaymentProvider } from './adapters/alipay.adapter.js';
import { WechatPaymentProvider } from './adapters/wechat.adapter.js';

/**
 * 根据共享配置组装支付渠道注册表。
 * - sandbox：注册沙箱适配器（无需商户密钥）。
 * - alipay / wechat：注册对应真实渠道适配器（缺商户参数时在调用期报错）。
 * 返回 registry 与当前模式对应的 provider key，供 API 直接使用。
 */
export function buildPaymentRegistry(cfg: PaymentEnvConfig): {
  registry: PaymentRegistry;
  activeProvider: 'sandbox' | 'alipay' | 'wechat';
} {
  const registry = new PaymentRegistry();
  const base = { returnBaseUrl: cfg.returnBaseUrl, notifyUrl: cfg.notifyUrl };

  registry.register(new SandboxPaymentProvider(base));
  if (cfg.alipay) registry.register(new AlipayPaymentProvider(cfg.alipay));
  if (cfg.wechat) registry.register(new WechatPaymentProvider(cfg.wechat));

  return { registry, activeProvider: cfg.mode };
}