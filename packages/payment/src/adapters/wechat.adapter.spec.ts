import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCipheriv,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { WechatPaymentProvider } from './wechat.adapter';

/**
 * Wechat APIv3 适配器测试：
 * 1. webhook 验签：用商户私钥签名，用平台证书公钥（这里复用同一 keypair）验签。
 * 2. AES-256-GCM 解密 resource.ciphertext：用 apiV3Key 加密，验证 adapter 解密回原 JSON。
 * 3. queryPayment / closePayment 通过 fetch mock 验证签名与请求体结构。
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

/**
 * 用 apiV3Key + AES-256-GCM 加密 payload，返回微信 webhook envelope。
 * 输出格式与真实微信回调一致：{ resource: { ciphertext, nonce, associated_data } }。
 */
function encryptWechatResource(apiV3Key: string, plaintext: object, associatedData = 'transaction'): {
  ciphertext: string;
  nonce: string;
  associated_data: string;
} {
  const nonce = randomBytes(12).toString('utf8').slice(0, 12);
  const key = Buffer.from(apiV3Key, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const data = Buffer.from(JSON.stringify(plaintext), 'utf8');
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  // 微信约定：ciphertext = base64(enc + tag)
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce,
    associated_data: associatedData,
  };
}

describe('WechatPaymentProvider', () => {
  let pair: RsaPair;
  let provider: WechatPaymentProvider;
  const apiV3Key = '01234567890123456789012345678901'; // 32 bytes
  let fetchMock: ReturnType<typeof vi.fn>;
  // 固定时钟，让 webhook 时间戳落在合法窗口内（P0 红队：时间窗校验）。
  const NOW_SEC = 1_800_000_000;

  beforeEach(() => {
    pair = generateRsaPair();
    provider = new WechatPaymentProvider(
      {
        appId: 'wxabcdef0123456789',
        mchId: '1900000001',
        apiV3Key,
        serialNo: 'SERIAL-0001',
        privateKey: pair.privateKeyPem,
        // 测试中复用商户 keypair 当作平台证书（生产环境应使用微信平台证书）。
        platformCert: pair.publicKeyPem,
      },
      () => NOW_SEC,
    );
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('config validation', () => {
    it('throws PAYMENT_CHANNEL_NOT_CONFIGURED when required fields missing', async () => {
      const p = new WechatPaymentProvider(null);
      await expect(p.createPayment({ orderId: 'o', amountCents: 1, subject: 's', notifyUrl: 'n' }))
        .rejects.toThrow('requires merchant credentials');
    });

    it('rejects malformed privateKey PEM', async () => {
      const p = new WechatPaymentProvider({
        appId: 'a',
        mchId: 'm',
        apiV3Key,
        serialNo: 's',
        privateKey: 'not-a-pem',
        platformCert: pair.publicKeyPem,
      });
      await expect(p.createPayment({ orderId: 'o', amountCents: 1, subject: 's', notifyUrl: 'n' }))
        .rejects.toThrow('not a valid PEM');
    });

    it('throws PAYMENT_CALLBACK_INVALID when platformCert missing on webhook', async () => {
      const p = new WechatPaymentProvider(
        {
          appId: 'a',
          mchId: 'm',
          apiV3Key,
          serialNo: 's',
          privateKey: pair.privateKeyPem,
        },
        () => NOW_SEC,
      );
      await expect(
        p.verifyNotification('body', {
          'Wechatpay-Timestamp': String(NOW_SEC),
          'Wechatpay-Nonce': 'n',
          'Wechatpay-Signature': 's',
        }),
      ).rejects.toThrow('platformCert not configured');
    });
  });

  describe('verifyNotification', () => {
    function buildWebhookBody(plaintext: object) {
      const resource = encryptWechatResource(apiV3Key, plaintext);
      const body = JSON.stringify({
        id: 'evt-001',
        create_time: '1700000000',
        event_type: 'TRANSACTION.SUCCESS',
        resource_type: 'encrypt-resource',
        resource,
      });
      return { body, resource };
    }

    function signWebhook(method: string, url: string, timestamp: string, nonce: string, body: string): string {
      const signString = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
      return createSign('RSA-SHA256').update(signString, 'utf8').sign(pair.privateKeyPem, 'base64');
    }

    it('verifies signature and decrypts resource to obtain out_trade_no + amount', async () => {
      const { body } = buildWebhookBody({
        out_trade_no: 'order-xyz',
        transaction_id: 'wx-txn-001',
        trade_state: 'SUCCESS',
        amount: { total: 1999, payer_total: 1999, currency: 'CNY' },
      });
      const timestamp = String(NOW_SEC);
      const nonce = 'nonce-abc';
      const notifyUrl = '/api/v1/payment/notify/wechat';
      const signature = signWebhook('POST', notifyUrl, timestamp, nonce, body);

      const n = await provider.verifyNotification(body, {
        'Wechatpay-Timestamp': timestamp,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Signature': signature,
        'Wechatpay-Serial': 'SERIAL-PLAT-001',
      }, { method: 'POST', url: notifyUrl });

      expect(n).not.toBeNull();
      expect(n!.orderId).toBe('order-xyz');
      expect(n!.tradeNo).toBe('wx-txn-001');
      expect(n!.amountCents).toBe(1999);
      expect(n!.status).toBe('success');
    });

    it('returns null when webhook headers missing', async () => {
      const n = await provider.verifyNotification('{}', {});
      expect(n).toBeNull();
    });

    it('rejects tampered body (signature mismatch)', async () => {
      const { body } = buildWebhookBody({
        out_trade_no: 'order-tampered',
        transaction_id: 't',
        trade_state: 'SUCCESS',
        amount: { total: 100, payer_total: 100 },
      });
      const timestamp = String(NOW_SEC);
      const nonce = 'nonce-abc';
      const notifyUrl = '/api/v1/payment/notify/wechat';
      const signature = signWebhook('POST', notifyUrl, timestamp, nonce, body);

      // 篡改 envelope 的 id 字段（属于签名覆盖范围），签名应失效。
      const tampered = body.replace('"id":"evt-001"', '"id":"evt-002"');
      await expect(
        provider.verifyNotification(tampered, {
          'Wechatpay-Timestamp': timestamp,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Signature': signature,
        }, { method: 'POST', url: notifyUrl }),
      ).rejects.toThrow('signature mismatch');
    });

    it('treats non-SUCCESS trade_state as failed', async () => {
      const { body } = buildWebhookBody({
        out_trade_no: 'o',
        transaction_id: 't',
        trade_state: 'NOTPAY',
        // 金额非 0 以通过 adapter 的 amount 校验，本测试只关心状态映射。
        amount: { total: 100, payer_total: 100 },
      });
      const timestamp = String(NOW_SEC);
      const nonce = 'nonce-abc';
      const notifyUrl = '/api/v1/payment/notify/wechat';
      const signature = signWebhook('POST', notifyUrl, timestamp, nonce, body);
      const n = await provider.verifyNotification(body, {
        'Wechatpay-Timestamp': timestamp,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Signature': signature,
      }, { method: 'POST', url: notifyUrl });
      expect(n!.status).toBe('failed');
    });

    it('round-trips a signature via createSign + createVerify (sanity)', () => {
      // 直接验证 RSA-SHA256 sign/verify 工具链没问题。
      const msg = 'POST\n/v3/x\n1\nn\n{}\n';
      const sig = createSign('RSA-SHA256').update(msg, 'utf8').sign(pair.privateKeyPem, 'base64');
      const ok = createVerify('RSA-SHA256').update(msg, 'utf8').verify(pair.publicKeyPem, sig, 'base64');
      expect(ok).toBe(true);
    });

    it('rejects malformed ciphertext (auth tag mismatch)', async () => {
      // 用错误的 apiV3Key 加密，但用正确的 apiV3Key 解密 → auth tag 校验失败
      const wrongKey = '99999999999999999999999999999999';
      const resource = encryptWechatResource(wrongKey, { out_trade_no: 'o', transaction_id: 't', trade_state: 'SUCCESS', amount: { total: 100, payer_total: 100 } });
      const body = JSON.stringify({ id: 'evt', resource });
      const timestamp = String(NOW_SEC);
      const nonce = 'n';
      const notifyUrl = '/api/v1/payment/notify/wechat';
      const signature = signWebhook('POST', notifyUrl, timestamp, nonce, body);

      await expect(
        provider.verifyNotification(body, {
          'Wechatpay-Timestamp': timestamp,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Signature': signature,
        }, { method: 'POST', url: notifyUrl }),
      ).rejects.toThrow('AES-256-GCM decryption failed');
    });

    it('rejects a replayed webhook (stale Wechatpay-Timestamp) despite valid signature', async () => {
      // P0 红队：时间窗校验。签名有效但时间戳已过期（>5 分钟）→ 必须拒绝重放。
      const { body } = buildWebhookBody({
        out_trade_no: 'order-replay',
        transaction_id: 't',
        trade_state: 'SUCCESS',
        amount: { total: 100, payer_total: 100 },
      });
      const staleTs = String(NOW_SEC - 600); // 10 分钟前（超出 5 分钟窗口）
      const nonce = 'nonce-replay';
      const notifyUrl = '/api/v1/payment/notify/wechat';
      const signature = signWebhook('POST', notifyUrl, staleTs, nonce, body);

      await expect(
        provider.verifyNotification(body, {
          'Wechatpay-Timestamp': staleTs,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Signature': signature,
        }, { method: 'POST', url: notifyUrl }),
      ).rejects.toThrow('timestamp out of acceptable window');
    });

    it('rejects a future-dated webhook beyond clock skew', async () => {
      const { body } = buildWebhookBody({
        out_trade_no: 'order-future',
        transaction_id: 't',
        trade_state: 'SUCCESS',
        amount: { total: 100, payer_total: 100 },
      });
      const futureTs = String(NOW_SEC + 3000); // 未来 50 分钟
      const nonce = 'nonce-future';
      const notifyUrl = '/api/v1/payment/notify/wechat';
      const signature = signWebhook('POST', notifyUrl, futureTs, nonce, body);

      await expect(
        provider.verifyNotification(body, {
          'Wechatpay-Timestamp': futureTs,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Signature': signature,
        }, { method: 'POST', url: notifyUrl }),
      ).rejects.toThrow('timestamp out of acceptable window');
    });

    it('rejects when method in context differs from signed method', async () => {
      const { body } = buildWebhookBody({
        out_trade_no: 'order-method',
        transaction_id: 't',
        trade_state: 'SUCCESS',
        amount: { total: 100, payer_total: 100 },
      });
      const timestamp = String(NOW_SEC);
      const nonce = 'nonce-method';
      const notifyUrl = '/api/v1/payment/notify/wechat';
      // 用 POST 签名，但验签时传入 GET → 签名串不同 → 验签失败
      const signature = signWebhook('POST', notifyUrl, timestamp, nonce, body);

      await expect(
        provider.verifyNotification(body, {
          'Wechatpay-Timestamp': timestamp,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Signature': signature,
        }, { method: 'GET', url: notifyUrl }),
      ).rejects.toThrow('signature mismatch');
    });

    it('rejects when url in context differs from signed url', async () => {
      const { body } = buildWebhookBody({
        out_trade_no: 'order-url',
        transaction_id: 't',
        trade_state: 'SUCCESS',
        amount: { total: 100, payer_total: 100 },
      });
      const timestamp = String(NOW_SEC);
      const nonce = 'nonce-url';
      const signedUrl = '/api/v1/payment/notify/wechat';
      const tamperedUrl = '/api/v1/payment/notify/alipay';
      const signature = signWebhook('POST', signedUrl, timestamp, nonce, body);

      await expect(
        provider.verifyNotification(body, {
          'Wechatpay-Timestamp': timestamp,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Signature': signature,
        }, { method: 'POST', url: tamperedUrl }),
      ).rejects.toThrow('signature mismatch');
    });
  });

  describe('createPayment (mocked fetch)', () => {
    it('POSTs to /v3/pay/transactions/native and returns qrCode', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const res = await provider.createPayment({
        orderId: 'order-1',
        amountCents: 1999,
        subject: 'Test subject',
        notifyUrl: 'https://example.com/notify',
      });
      expect(res.tradeNo).toBe('order-1');
      expect(res.qrCode).toContain('weixin://wxpay');

      const call = fetchMock.mock.calls[0];
      const [url, init] = call;
      expect(url).toContain('/v3/pay/transactions/native');
      const body = JSON.parse(String(init.body));
      expect(body.appid).toBe('wxabcdef0123456789');
      expect(body.mchid).toBe('1900000001');
      expect(body.out_trade_no).toBe('order-1');
      expect(body.amount.total).toBe(1999);
      expect(body.amount.currency).toBe('CNY');

      // Authorization header 必须是 WECHATPAY2-SHA256-RSA2048 格式
      const auth = String(init.headers.Authorization);
      expect(auth).toMatch(/^WECHATPAY2-SHA256-RSA2048 mchid="1900000001"/);
      expect(auth).toContain('serial_no="SERIAL-0001"');
      expect(auth).toMatch(/signature="[A-Za-z0-9+/=]+"/);
    });

    it('throws PROVIDER_UPSTREAM_ERROR when wechat returns error code', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'PARAM_ERROR', message: 'invalid amount' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(
        provider.createPayment({ orderId: 'o', amountCents: 1, subject: 's', notifyUrl: 'n' }),
      ).rejects.toThrow(/Wechat createPayment failed/);
    });
  });

  describe('queryPayment / closePayment (mocked fetch)', () => {
    it('GETs /v3/pay/transactions/out-trade-no/{id} and maps trade_state', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            trade_state: 'SUCCESS',
            transaction_id: 'wx-txn-1',
            amount: { total: 1999, currency: 'CNY' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const r = await provider.queryPayment('wx-txn-1', 'order-1');
      expect(r.status).toBe('success');
      expect(r.amountCents).toBe(1999);
      expect(r.tradeNo).toBe('wx-txn-1');

      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain('/v3/pay/transactions/out-trade-no/order-1');
      expect(url).toContain('mchid=1900000001');
    });

    it('maps NOTPAY to pending and CLOSED to closed', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ trade_state: 'NOTPAY', amount: { total: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const r1 = await provider.queryPayment('', 'o');
      expect(r1.status).toBe('pending');

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ trade_state: 'CLOSED', amount: { total: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const r2 = await provider.queryPayment('', 'o');
      expect(r2.status).toBe('closed');
    });

    it('closePayment POSTs to /close with mchid body', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await provider.closePayment('order-1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/v3/pay/transactions/out-trade-no/order-1/close');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ mchid: '1900000001' });
    });
  });

  describe('signed request structure', () => {
    it('signs request body with RSA-SHA256 over method\\nurl\\ntimestamp\\nnonce\\nbody\\n (roundtrip)', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code_url: 'wxp://x' }), { status: 200 }),
      );
      await provider.createPayment({ orderId: 'o', amountCents: 1, subject: 's', notifyUrl: 'n' });

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const auth = String(init.headers.Authorization);
      // Extract signature from Authorization header
      const sigMatch = auth.match(/signature="([^"]+)"/);
      expect(sigMatch).not.toBeNull();
      const sig = sigMatch![1];
      const nonceMatch = auth.match(/nonce_str="([^"]+)"/);
      const tsMatch = auth.match(/timestamp="([^"]+)"/);
      const nonce = nonceMatch![1];
      const ts = tsMatch![1];

      const url = '/v3/pay/transactions/native';
      const body = String(init.body);
      const signString = `POST\n${url}\n${ts}\n${nonce}\n${body}\n`;
      const ok = createVerify('RSA-SHA256').update(signString, 'utf8').verify(pair.publicKeyPem, sig, 'base64');
      expect(ok).toBe(true);
    });
  });
});
