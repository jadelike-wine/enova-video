import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSign, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { AlipayPaymentProvider } from './alipay.adapter';

/**
 * Alipay 适配器测试：
 * 1. sign + verify roundtrip（用本地生成的 RSA2048 keypair 模拟支付宝商户密钥对）。
 * 2. createPayment 返回带 sign 的 URL。
 * 3. verifyNotification 接受正确签名、拒绝篡改。
 * 4. queryPayment / closePayment 通过 fetch mock 验证签名与请求体结构。
 */

interface RsaPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

function generateRsaPair(): RsaPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** 用官方协议（原始值直接拼接，不重新编码）构造一个合法的异步通知 form body。 */
function buildSignedNotification(pair: RsaPair, params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .sort();
  // 签名串：解码后的原始值直接 key=value 拼接（官方 rsaCheckV1.getSignContent，不 URL-encode）。
  const signingString = keys.map((k) => `${k}=${params[k]}`).join('&');
  const sign = createSign('RSA-SHA256').update(signingString, 'utf8').sign(pair.privateKeyPem, 'base64');
  // body 用标准 encodeURIComponent；adapter 解析后按原始值还原签名串。
  const pairs: string[] = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);
  pairs.push(`sign=${encodeURIComponent(sign)}`);
  return pairs.join('&');
}

function parseParamsFromUrl(url: string): Record<string, string> {
  const q = url.split('?')[1] ?? '';
  const out: Record<string, string> = {};
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = idx >= 0 ? pair.slice(0, idx) : pair;
    const v = idx >= 0 ? pair.slice(idx + 1) : '';
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

describe('AlipayPaymentProvider', () => {
  let pair: RsaPair;
  let provider: AlipayPaymentProvider;
  const gateway = 'https://openapi.alipay.com/gateway.do';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pair = generateRsaPair();
    provider = new AlipayPaymentProvider({
      appId: '2021000000000000',
      privateKey: pair.privateKeyPem,
      publicKey: pair.publicKeyPem,
      gateway,
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('createPayment', () => {
    it('returns a payUrl containing signed params (sorted + base64 RSA2 sign)', async () => {
      const res = await provider.createPayment({
        orderId: 'order-123',
        amountCents: 1999,
        subject: 'Test Subject',
        notifyUrl: 'https://example.com/notify',
      });
      expect(res.tradeNo).toBe('order-123');
      expect(res.payUrl).toBeDefined();
      expect(res.payUrl!.startsWith(gateway + '?')).toBe(true);

      const params = parseParamsFromUrl(res.payUrl!);
      expect(params.app_id).toBe('2021000000000000');
      expect(params.method).toBe('alipay.trade.page.pay');
      expect(params.sign_type).toBe('RSA2');
      expect(params.charset).toBe('utf-8');
      expect(params.version).toBe('1.0');
      expect(params.sign).toBeTruthy();

      // biz_content 应包含 out_trade_no / total_amount / product_code
      const biz = JSON.parse(params.biz_content);
      expect(biz.out_trade_no).toBe('order-123');
      expect(biz.total_amount).toBe('19.99');
      expect(biz.product_code).toBe('FAST_INSTANT_TRADE_PAY');
    });

    it('signs params so that verify(publicKey) returns true (roundtrip)', async () => {
      const res = await provider.createPayment({
        orderId: 'rt-1',
        amountCents: 100,
        subject: 'rt',
        notifyUrl: 'https://example.com/n',
      });
      const params = parseParamsFromUrl(res.payUrl!);

      // 用相同算法重算 signing string 并用 publicKey 验证 sign。
      // 官方协议：签名用**原始值**直接 key=value 拼接（不 URL-encode），传输层才编码。
      const keys = Object.keys(params).filter((k) => k !== 'sign').sort();
      const signingString = keys.map((k) => `${k}=${params[k]}`).join('&');
      const ok = createVerify('RSA-SHA256')
        .update(signingString, 'utf8')
        .verify(pair.publicKeyPem, params.sign, 'base64');
      expect(ok).toBe(true);
    });
  });

  describe('verifyNotification', () => {
    it('accepts a properly signed notification and parses fields', async () => {
      const params = {
        app_id: '2021000000000000',
        trade_no: 'alipay-trade-456',
        out_trade_no: 'order-123',
        total_amount: '19.99',
        trade_status: 'TRADE_SUCCESS',
        notify_id: 'N-1',
        notify_time: '2026-08-12 12:00:00',
        notify_type: 'trade_status_sync',
        sign_type: 'RSA2',
      };
      const body = buildSignedNotification(pair, params);

      const n = await provider.verifyNotification(body, {});
      expect(n).not.toBeNull();
      expect(n!.orderId).toBe('order-123');
      expect(n!.tradeNo).toBe('alipay-trade-456');
      expect(n!.amountCents).toBe(1999);
      expect(n!.status).toBe('success');
    });

    it('returns null when missing sign/out_trade_no', async () => {
      const n = await provider.verifyNotification('foo=bar', {});
      expect(n).toBeNull();
    });

    it('rejects a tampered notification (signature mismatch)', async () => {
      const params = {
        app_id: '2021000000000000',
        trade_no: 'alipay-trade-456',
        out_trade_no: 'order-123',
        total_amount: '19.99',
        trade_status: 'TRADE_SUCCESS',
        sign_type: 'RSA2',
      };
      const body = buildSignedNotification(pair, params);
      // 篡改 total_amount
      const tampered = body.replace('19.99', '999.99');
      await expect(provider.verifyNotification(tampered, {})).rejects.toThrow('signature mismatch');
    });

    it('treats TRADE_FINISHED as success and other statuses as failed', async () => {
      for (const [status, expected] of [
        ['TRADE_FINISHED', 'success'],
        ['WAIT_BUYER_PAY', 'failed'],
        ['TRADE_CLOSED', 'failed'],
      ] as const) {
        const params = {
          app_id: '2021000000000000',
          trade_no: 'T',
          out_trade_no: 'o',
          total_amount: '1.00',
          trade_status: status,
          sign_type: 'RSA2',
        };
        const body = buildSignedNotification(pair, params);
        const n = await provider.verifyNotification(body, {});
        expect(n!.status).toBe(expected);
      }
    });
  });

  describe('gateway methods (mocked fetch)', () => {
    function jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    it('queryPayment parses alipay_trade_query_response and maps trade_status', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          alipay_trade_query_response: {
            code: '10000',
            msg: 'Success',
            out_trade_no: 'order-123',
            trade_no: 'alipay-789',
            total_amount: '19.99',
            trade_status: 'TRADE_SUCCESS',
          },
          sign: 'sig',
        }),
      );
      const r = await provider.queryPayment('alipay-789', 'order-123');
      expect(r.status).toBe('success');
      expect(r.amountCents).toBe(1999);
      expect(r.tradeNo).toBe('alipay-789');

      // Verify the request body contains signed params for alipay.trade.query
      const call = fetchMock.mock.calls[0];
      const body = String(call[1].body);
      expect(body).toContain('method=alipay.trade.query');
      expect(body).toMatch(/sign=/);
      const biz = JSON.parse(parseParamsFromUrl('?' + body).biz_content);
      expect(biz.out_trade_no).toBe('order-123');
      expect(biz.trade_no).toBe('alipay-789');
    });

    it('queryPayment maps WAIT_BUYER_PAY to pending and TRADE_CLOSED to closed', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          alipay_trade_query_response: {
            code: '10000',
            out_trade_no: 'o',
            trade_no: 't',
            total_amount: '1.00',
            trade_status: 'WAIT_BUYER_PAY',
          },
        }),
      );
      const r1 = await provider.queryPayment('t', 'o');
      expect(r1.status).toBe('pending');

      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          alipay_trade_query_response: {
            code: '10000',
            out_trade_no: 'o',
            trade_no: 't',
            total_amount: '1.00',
            trade_status: 'TRADE_CLOSED',
          },
        }),
      );
      const r2 = await provider.queryPayment('t', 'o');
      expect(r2.status).toBe('closed');
    });

    it('closePayment POSTs alipay.trade.close', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ alipay_trade_close_response: { code: '10000', msg: 'Success' } }));
      await provider.closePayment('order-close');
      const body = String(fetchMock.mock.calls[0][1].body);
      expect(body).toContain('method=alipay.trade.close');
      const biz = JSON.parse(parseParamsFromUrl('?' + body).biz_content);
      expect(biz.out_trade_no).toBe('order-close');
    });

    it('throws PROVIDER_UPSTREAM_ERROR on HTTP failure', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));
      await expect(provider.queryPayment('t', 'o')).rejects.toThrow(/Alipay gateway HTTP 502/);
    });

    it('includes a stable nonce-like randomness via timestamp/sign and signs request', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ alipay_trade_close_response: { code: '10000' } }));
      await provider.closePayment('o');
      const body = String(fetchMock.mock.calls[0][1].body);
      const params = parseParamsFromUrl('?' + body);
      expect(params.sign_type).toBe('RSA2');
      expect(params.sign).toBeTruthy();
      // Verify sign roundtrip（原始值拼接，传输层编码）
      const keys = Object.keys(params).filter((k) => k !== 'sign').sort();
      const signingString = keys.map((k) => `${k}=${params[k]}`).join('&');
      const ok = createVerify('RSA-SHA256')
        .update(signingString, 'utf8')
        .verify(pair.publicKeyPem, params.sign, 'base64');
      expect(ok).toBe(true);
    });
  });

  describe('config validation', () => {
    it('rejects config with missing appId via PAYMENT_CHANNEL_NOT_CONFIGURED', async () => {
      const p = new AlipayPaymentProvider({ appId: '', privateKey: 'x', publicKey: 'y', gateway });
      await expect(p.createPayment({ orderId: 'o', amountCents: 1, subject: 's', notifyUrl: 'n' }))
        .rejects.toThrow('requires merchant credentials');
    });

    it('rejects malformed privateKey PEM', async () => {
      const p = new AlipayPaymentProvider({ appId: 'a', privateKey: 'not-a-pem', publicKey: pair.publicKeyPem, gateway });
      await expect(p.createPayment({ orderId: 'o', amountCents: 1, subject: 's', notifyUrl: 'n' }))
        .rejects.toThrow('not a valid PEM');
    });

    it('rejects invalid publicKey PEM during verifyNotification', async () => {
      const p = new AlipayPaymentProvider({ appId: 'a', privateKey: pair.privateKeyPem, publicKey: 'not-a-pem', gateway });
      const body = 'out_trade_no=o&sign=xyz&trade_status=TRADE_SUCCESS&total_amount=1.00';
      await expect(p.verifyNotification(body, {})).rejects.toThrow('verify failed');
    });
  });

  it('handles random bytes for non-deterministic nonces in unrelated helpers', () => {
    // Sanity check that crypto helpers used in tests are stable.
    const b = randomBytes(8).toString('hex');
    expect(b).toHaveLength(16);
  });
});
