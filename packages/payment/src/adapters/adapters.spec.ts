import { describe, expect, it } from 'vitest';
import { SandboxPaymentProvider } from './sandbox.adapter';
import { buildPaymentRegistry } from '../factory';
import { AlipayPaymentProvider } from './alipay.adapter';
import { WechatPaymentProvider } from './wechat.adapter';

const base = { returnBaseUrl: 'http://localhost:3001', notifyUrl: 'http://localhost:3001/api/v1/payment/notify' };

describe('SandboxPaymentProvider', () => {
  const provider = new SandboxPaymentProvider(base);

  it('createPayment returns a virtual tradeNo and payUrl', async () => {
    const res = await provider.createPayment({ orderId: 'o1', amountCents: 1000, subject: 's', notifyUrl: base.notifyUrl });
    expect(res.tradeNo).toMatch(/^SANDBOX-o1-/);
    expect(res.payUrl).toContain('/pay/sandbox/o1');
  });

  it('verifyNotification parses a success body', async () => {
    const n = await provider.verifyNotification(
      JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' }),
      {},
    );
    expect(n).toMatchObject({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' });
  });

  it('verifyNotification rejects invalid body', async () => {
    await expect(provider.verifyNotification('not-json', {})).rejects.toThrow('Invalid sandbox notification body');
    await expect(provider.verifyNotification(JSON.stringify({ status: 'success' }), {})).rejects.toThrow('missing orderId/tradeNo');
  });
});

describe('buildPaymentRegistry', () => {
  it('sandbox mode registers sandbox and selects it as active', () => {
    const { registry, activeProvider } = buildPaymentRegistry({
      mode: 'sandbox',
      creditsPerCny: 100,
      minRechargeCents: 100,
      ...base,
    });
    expect(activeProvider).toBe('sandbox');
    expect(registry.has('sandbox')).toBe(true);
  });

  it('registers alipay/wechat only when config present', () => {
    const { registry } = buildPaymentRegistry({
      mode: 'alipay',
      creditsPerCny: 100,
      minRechargeCents: 100,
      ...base,
      alipay: { appId: 'a', privateKey: 'k', publicKey: 'p', gateway: 'g' },
      wechat: { appId: 'w', mchId: 'm', apiV3Key: 'v', serialNo: 's', privateKey: 'k' },
    });
    expect(registry.has('alipay')).toBe(true);
    expect(registry.has('wechat')).toBe(true);
  });

  it('active provider is not configured when mode requires missing credentials', () => {
    const { registry } = buildPaymentRegistry({ mode: 'alipay', creditsPerCny: 100, minRechargeCents: 100, ...base });
    expect(registry.has('alipay')).toBe(false);
    expect(() => registry.get('alipay')).toThrow('Payment channel not configured');
  });
});

describe('AlipayPaymentProvider / WechatPaymentProvider config gating', () => {
  it('throws PAYMENT_CHANNEL_NOT_CONFIGURED when credentials missing', async () => {
    const alipay = new AlipayPaymentProvider(null);
    await expect(alipay.createPayment()).rejects.toThrow('requires merchant credentials');
    const wechat = new WechatPaymentProvider(null);
    await expect(wechat.createPayment()).rejects.toThrow('requires merchant credentials');
  });

  it('throws clear non-implemented error when credentials present (local cannot verify)', async () => {
    const alipay = new AlipayPaymentProvider({ appId: 'a', privateKey: 'k', publicKey: 'p', gateway: 'g' });
    await expect(alipay.createPayment()).rejects.toThrow('use sandbox mode');
  });
});