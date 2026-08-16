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

  it('queryPayment returns success mock', async () => {
    const r = await provider.queryPayment('T1', 'o1');
    expect(r.status).toBe('success');
    expect(r.tradeNo).toBe('T1');
  });

  it('closePayment is a no-op', async () => {
    await expect(provider.closePayment('o1')).resolves.toBeUndefined();
  });

  // BUG-004: Sandbox notify 鉴权测试
  describe('sandbox secret authentication (BUG-004)', () => {
    const secret = 'test-sandbox-secret-12345';
    const providerWithSecret = new SandboxPaymentProvider(base, secret);

    it('rejects notify without X-Sandbox-Secret when secret is configured', async () => {
      await expect(
        providerWithSecret.verifyNotification(
          JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' }),
          {},
        ),
      ).rejects.toThrow('missing or invalid X-Sandbox-Secret');
    });

    it('rejects notify with wrong X-Sandbox-Secret', async () => {
      await expect(
        providerWithSecret.verifyNotification(
          JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' }),
          { 'X-Sandbox-Secret': 'wrong-secret' },
        ),
      ).rejects.toThrow('missing or invalid X-Sandbox-Secret');
    });

    it('accepts notify with correct X-Sandbox-Secret', async () => {
      const n = await providerWithSecret.verifyNotification(
        JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' }),
        { 'X-Sandbox-Secret': secret },
      );
      expect(n).toMatchObject({ orderId: 'o1', tradeNo: 'T1', status: 'success' });
    });

    it('no secret configured → backward compatible (no auth required)', async () => {
      const n = await provider.verifyNotification(
        JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' }),
        {},
      );
      expect(n).toMatchObject({ orderId: 'o1', status: 'success' });
    });
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

  it('rejects malformed Alipay privateKey PEM as PAYMENT_CHANNEL_NOT_CONFIGURED', async () => {
    const alipay = new AlipayPaymentProvider({ appId: 'a', privateKey: 'k', publicKey: 'p', gateway: 'g' });
    await expect(alipay.createPayment({ orderId: 'o1', amountCents: 100, subject: 's', notifyUrl: 'n' }))
      .rejects.toThrow('not a valid PEM');
  });
});