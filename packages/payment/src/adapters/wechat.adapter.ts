import { createDecipheriv, createPrivateKey, createSign, createVerify, randomBytes, type KeyObject } from 'node:crypto';
import { domainError, ERROR_CODES } from '@enova/contracts';
import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentNotification,
  PaymentProvider,
  PaymentQueryResult,
  WechatConfig,
} from '../payment.types.js';

/**
 * 微信支付（APIv3）适配器。
 *
 * 实现：
 * - createPayment: POST /v3/pay/transactions/native，返回 code_url（QR）。支持 jsapi/h5 可扩展。
 * - verifyNotification: APIv3 webhook，先验签（平台证书公钥 RSA-SHA256），再 AES-256-GCM 解密 resource.ciphertext。
 * - queryPayment / closePayment: 走 /v3/pay/* 标准 REST。
 *
 * 签名：
 * - Authorization: WECHATPAY2-SHA256-RSA2048 mchid="..." nonce_str="..." timestamp="..." serial_no="..." signature="..."
 * - 签名串格式：`{method}\n{url}\n{timestamp}\n{nonce}\n{body}\n`（最后有换行）。
 *
 * 依赖：仅 node:crypto + 全局 fetch（Node 20+），不引入新依赖。
 */
export class WechatPaymentProvider implements PaymentProvider {
  readonly key = 'wechat' as const;
  readonly name = 'Wechat Pay';

  private cachedPrivateKey: KeyObject | null = null;
  private cachedPlatformCertPem: string | null = null;

  constructor(
    private readonly config: WechatConfig | null,
    /** 可注入时钟（秒）用于测试时间窗；生产默认 Date.now()/1000。 */
    private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private requireConfig(): WechatConfig {
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

  private loadPrivateKey(): KeyObject {
    if (this.cachedPrivateKey) return this.cachedPrivateKey;
    const cfg = this.requireConfig();
    const pem = normalizePem(cfg.privateKey);
    try {
      this.cachedPrivateKey = createPrivateKey({ key: pem, format: 'pem' });
    } catch (err) {
      throw domainError(
        ERROR_CODES.PAYMENT_CHANNEL_NOT_CONFIGURED,
        'Wechat privateKey is not a valid PEM (PKCS#1/PKCS#8 expected)',
        500,
        { cause: (err as Error).message },
      );
    }
    return this.cachedPrivateKey;
  }

  private loadPlatformCertPem(): string {
    if (this.cachedPlatformCertPem) return this.cachedPlatformCertPem;
    const cfg = this.requireConfig();
    if (!cfg.platformCert) {
      // 生产安全约束：未配置平台证书时无法验证 webhook 签名。
      throw domainError(
        ERROR_CODES.PAYMENT_CALLBACK_INVALID,
        'Wechat platformCert not configured; cannot verify webhook signature (set payment.wechatPlatformCert)',
        400,
      );
    }
    this.cachedPlatformCertPem = normalizePem(cfg.platformCert);
    return this.cachedPlatformCertPem;
  }

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const cfg = this.requireConfig();
    const path = '/v3/pay/transactions/native';
    const body = JSON.stringify({
      appid: cfg.appId,
      mchid: cfg.mchId,
      description: req.subject,
      out_trade_no: req.orderId,
      notify_url: req.notifyUrl,
      amount: { total: req.amountCents, currency: 'CNY' },
    });

    const resp = await this.signedRequest('POST', path, body);
    const json = (await resp.json()) as { code_url?: string; code?: string; message?: string };
    if (!resp.ok || !json.code_url) {
      throw domainError(
        ERROR_CODES.PROVIDER_UPSTREAM_ERROR,
        `Wechat createPayment failed: ${json.code ?? resp.status} ${json.message ?? ''}`,
        502,
        json,
      );
    }
    return {
      // 微信扫码下单不返回 transaction_id，等支付完成后异步通知才带回真实交易号；
      // 这里以 out_trade_no 占位，调用方收到 notify 后用 transaction_id 覆盖。
      tradeNo: req.orderId,
      qrCode: json.code_url,
    };
  }

  async verifyNotification(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<PaymentNotification | null> {
    this.requireConfig();

    const timestamp = headers['wechatpay-timestamp'] ?? headers['Wechatpay-Timestamp'];
    const nonce = headers['wechatpay-nonce'] ?? headers['Wechatpay-Nonce'];
    const signature = headers['wechatpay-signature'] ?? headers['Wechatpay-Signature'];
    if (!timestamp || !nonce || !signature) {
      return null;
    }
    if (!/^\d+$/.test(timestamp)) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat notification invalid Wechatpay-Timestamp', 400);
    }
    // APIv3 官方要求：验签前校验时间戳在 ±5 分钟内，防止重放攻击。
    // 生产无此校验时，攻击者可重放一份已捕获的合法 webhook；虽下游幂等，但应按官方规范 fail-closed。
    const ts = Number(timestamp);
    const now = this.nowSec();
    if (ts < now - NOTIFY_MAX_AGE_SEC || ts > now + CLOCK_SKEW_SEC) {
      throw domainError(
        ERROR_CODES.PAYMENT_CALLBACK_INVALID,
        'Wechat notification timestamp out of acceptable window (possible replay)',
        400,
        { timestamp: ts, now },
      );
    }

    // 验签串：`timestamp\nnonce\nbody\n`（body 即原始 rawBody）。
    const signString = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const platformCertPem = this.loadPlatformCertPem();
    let valid: boolean;
    try {
      valid = createVerify('RSA-SHA256').update(signString, 'utf8').verify(platformCertPem, signature, 'base64');
    } catch (err) {
      throw domainError(
        ERROR_CODES.PAYMENT_CALLBACK_INVALID,
        'Wechat notification verify failed',
        400,
        { cause: (err as Error).message },
      );
    }
    if (!valid) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat notification signature mismatch', 400);
    }

    // 解析 outer envelope，拿到 resource 字段。
    let envelope: { resource?: WechatResourceEnvelope; event_type?: string };
    try {
      envelope = JSON.parse(rawBody) as { resource?: WechatResourceEnvelope; event_type?: string };
    } catch {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat notification body is not JSON', 400);
    }
    const resource = envelope.resource;
    if (!resource || !resource.ciphertext || !resource.nonce) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat notification missing resource.ciphertext/nonce', 400);
    }

    const decryptedJson = decryptWechatResource(
      this.requireConfig().apiV3Key,
      resource.nonce,
      resource.associated_data ?? '',
      resource.ciphertext,
    );

    const data = JSON.parse(decryptedJson) as {
      out_trade_no?: string;
      transaction_id?: string;
      trade_state?: string;
      amount?: { payer_total?: number; total?: number };
    };
    if (!data.out_trade_no) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat notification missing out_trade_no', 400);
    }

    const tradeState = String(data.trade_state ?? '');
    const status: PaymentNotification['status'] = tradeState === 'SUCCESS' ? 'success' : 'failed';
    const amountCents = Number(data.amount?.payer_total ?? data.amount?.total ?? 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat notification invalid amount', 400);
    }

    return {
      orderId: data.out_trade_no,
      tradeNo: data.transaction_id ?? data.out_trade_no,
      amountCents,
      status,
      raw: { envelope, decrypted: data },
    };
  }

  async queryPayment(_tradeNo: string, orderId: string): Promise<PaymentQueryResult> {
    const cfg = this.requireConfig();
    if (!orderId) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'Wechat queryPayment requires orderId (out_trade_no)', 400);
    }
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${encodeURIComponent(cfg.mchId)}`;
    const resp = await this.signedRequest('GET', path, '');
    const data = (await resp.json()) as {
      trade_state?: string;
      transaction_id?: string;
      amount?: { total?: number };
      code?: string;
      message?: string;
    };
    if (!resp.ok || !data.trade_state) {
      throw domainError(
        ERROR_CODES.PROVIDER_UPSTREAM_ERROR,
        `Wechat queryPayment failed: ${data.code ?? resp.status} ${data.message ?? ''}`,
        502,
        data,
      );
    }
    return {
      status: mapWechatTradeState(data.trade_state),
      amountCents: Number(data.amount?.total ?? 0),
      tradeNo: data.transaction_id ?? orderId,
      raw: data as Record<string, unknown>,
    };
  }

  async closePayment(orderId: string): Promise<void> {
    const cfg = this.requireConfig();
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}/close`;
    const body = JSON.stringify({ mchid: cfg.mchId });
    const resp = await this.signedRequest('POST', path, body);
    if (!resp.ok && resp.status !== 204) {
      const data = (await resp.json().catch(() => ({}))) as { code?: string; message?: string };
      throw domainError(
        ERROR_CODES.PROVIDER_UPSTREAM_ERROR,
        `Wechat closePayment failed: ${data.code ?? resp.status} ${data.message ?? ''}`,
        502,
        data,
      );
    }
  }

  /**
   * 调用微信 APIv3：组装 Authorization header 后用 fetch 发起请求。
   * url 为 path（含 query string），不包含 host。
   */
  private async signedRequest(method: 'GET' | 'POST', url: string, body: string): Promise<Response> {
    const cfg = this.requireConfig();
    this.loadPrivateKey();

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const signString = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = createSign('RSA-SHA256').update(signString, 'utf8').sign(this.loadPrivateKey(), 'base64');

    const authorization =
      `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",` +
      `nonce_str="${nonce}",timestamp="${timestamp}",` +
      `serial_no="${cfg.serialNo}",signature="${signature}"`;

    const headers: Record<string, string> = {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (method === 'POST' && body) headers['Content-Length'] = Buffer.byteLength(body).toString();

    return fetch(`https://api.mch.weixin.qq.com${url}`, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
    });
  }
}

/* ----------------------------- helpers ----------------------------- */

/** APIv3 webhook 时间戳合法窗口：允许早于当前 5 分钟（官方建议），容忍时钟偏差 60s。 */
const NOTIFY_MAX_AGE_SEC = 300;
const CLOCK_SKEW_SEC = 60;

interface WechatResourceEnvelope {
  algorithm?: string;
  ciphertext?: string;
  nonce?: string;
  associated_data?: string;
  original_type?: string;
}

/** 规范化 PEM：补齐 header/footer，兼容单行裸 base64。 */
function normalizePem(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  // 单行裸 base64 → 包成 CERTIFICATE PEM（平台证书）或 PRIVATE KEY PEM（私钥）。
  // 这里无法区分，按 CERTIFICATE 包，createPrivateKey/createVerify 会自行判定。
  return `-----BEGIN CERTIFICATE-----\n${chunk(trimmed, 64)}\n-----END CERTIFICATE-----\n`;
}

function chunk(s: string, size: number): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.join('\n');
}

/**
 * AES-256-GCM 解密 resource.ciphertext：
 * - key = apiV3Key（32 字节 UTF-8）
 * - iv = resource.nonce
 * - aad = resource.associated_data
 * - ciphertext = base64decode(resource.ciphertext)，末尾 16 字节为 GCM auth tag。
 */
function decryptWechatResource(apiV3Key: string, nonce: string, associatedData: string, ciphertextB64: string): string {
  const key = Buffer.from(apiV3Key, 'utf8');
  if (key.length !== 32) {
    throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat apiV3Key must be 32 bytes', 400);
  }
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < 16) {
    throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Wechat ciphertext too short', 400);
  }
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  try {
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return decrypted;
  } catch (err) {
    throw domainError(
      ERROR_CODES.PAYMENT_CALLBACK_INVALID,
      'Wechat AES-256-GCM decryption failed (bad auth tag or key)',
      400,
      { cause: (err as Error).message },
    );
  }
}

function mapWechatTradeState(s: string): PaymentQueryResult['status'] {
  switch (s) {
    case 'SUCCESS':
      return 'success';
    case 'NOTPAY':
    case 'USERPAYING':
      return 'pending';
    case 'CLOSED':
    case 'REVOKED':
      return 'closed';
    default:
      return 'failed';
  }
}
