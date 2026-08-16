import { createPrivateKey, createSign, createVerify, type KeyObject } from 'node:crypto';
import { domainError, ERROR_CODES } from '@enova/contracts';
import type {
  AlipayConfig,
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentNotification,
  PaymentProvider,
  PaymentQueryResult,
} from '../payment.types.js';

/**
 * 支付宝适配器（真实渠道）。
 *
 * 实现：
 * - createPayment: alipay.trade.page.pay，RSA2 签名后拼装跳转 URL。
 * - verifyNotification: 异步通知 form-encoded 参数验签。
 * - queryPayment / closePayment: 走网关 POST + biz_content。
 *
 * 金额规约：
 * - 内部全部分（整数）；Alipay 网关用元（字符串，2 位小数）。
 * - yuan = (cents / 100).toFixed(2)；cents = Math.round(Number(yuan) * 100)。
 *
 * 依赖：仅 node:crypto + 全局 fetch（Node 20+），不引入新依赖。
 */
export class AlipayPaymentProvider implements PaymentProvider {
  readonly key = 'alipay' as const;
  readonly name = 'Alipay';

  private cachedPrivateKey: KeyObject | null = null;
  private cachedPublicKeyPem: string | null = null;

  constructor(private readonly config: AlipayConfig | null) {}

  private requireConfig(): AlipayConfig {
    if (!this.config || !this.config.appId || !this.config.privateKey || !this.config.publicKey) {
      throw domainError(
        ERROR_CODES.PAYMENT_CHANNEL_NOT_CONFIGURED,
        'Alipay real channel requires merchant credentials (ALIPAY_* env)',
        400,
      );
    }
    return this.config;
  }

  /** 加载商户私钥为 KeyObject（兼容 PKCS#1 / PKCS#8 PEM）。 */
  private loadPrivateKey(): KeyObject {
    if (this.cachedPrivateKey) return this.cachedPrivateKey;
    const cfg = this.requireConfig();
    const pem = normalizePem(cfg.privateKey);
    try {
      this.cachedPrivateKey = createPrivateKey({ key: pem, format: 'pem' });
    } catch (err) {
      throw domainError(
        ERROR_CODES.PAYMENT_CHANNEL_NOT_CONFIGURED,
        'Alipay privateKey is not a valid PEM (PKCS#1/PKCS#8 expected)',
        500,
        { cause: (err as Error).message },
      );
    }
    return this.cachedPrivateKey;
  }

  /** 商户公钥 PEM（用于本地校验，正常通知验签使用支付宝平台公钥/同商户公钥）。 */
  private loadPublicKeyPem(): string {
    if (this.cachedPublicKeyPem) return this.cachedPublicKeyPem;
    const cfg = this.requireConfig();
    this.cachedPublicKeyPem = normalizePem(cfg.publicKey);
    return this.cachedPublicKeyPem;
  }

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const cfg = this.requireConfig();
    this.loadPrivateKey();

    const bizContent: Record<string, unknown> = {
      out_trade_no: req.orderId,
      total_amount: centsToYuan(req.amountCents),
      subject: req.subject,
      product_code: 'FAST_INSTANT_TRADE_PAY',
    };
    if (req.returnUrl) bizContent.passback_params = req.returnUrl;

    const params = this.buildSignedParams({
      app_id: cfg.appId,
      method: 'alipay.trade.page.pay',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: alipayTimestamp(new Date()),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
      notify_url: req.notifyUrl,
      ...(req.returnUrl ? { return_url: req.returnUrl } : {}),
    });

    const payUrl = `${cfg.gateway}?${params}`;
    return {
      // 支付宝下单不会立即返回 trade_no（trade_no 在异步通知/查单时才出现），
      // 这里用 orderId 作为占位，待 notify/query 阶段拿到真实 trade_no 后由调用方覆盖。
      tradeNo: req.orderId,
      payUrl,
    };
  }

  async verifyNotification(
    rawBody: string,
    _headers: Record<string, string>,
  ): Promise<PaymentNotification | null> {
    const cfg = this.requireConfig();
    this.loadPublicKeyPem();

    // Alipay 异步通知为 form-encoded，不区分 content-type，统一按 form 解析。
    const params = parseFormBody(rawBody);
    if (!params.sign || !params.out_trade_no) {
      return null;
    }

    const signedString = buildAlipaySignedString(params);
    const signature = String(params.sign);
    let valid: boolean;
    try {
      valid = createVerify('RSA-SHA256')
        .update(signedString, 'utf8')
        .verify(this.loadPublicKeyPem(), signature, 'base64');
    } catch (err) {
      throw domainError(
        ERROR_CODES.PAYMENT_CALLBACK_INVALID,
        'Alipay notification verify failed',
        400,
        { cause: (err as Error).message },
      );
    }
    if (!valid) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Alipay notification signature mismatch', 400);
    }

    // P2 修复：字段级业务校验。
    // 验签只检查签名本身，未校验 app_id 与当前配置是否一致，
    // 攻击者可用另一个合法签名的通知冒充本商户入账。
    // 参考 sub2api：service 层校验 appId/seller/金额一致。
    const notifyAppId = String(params.app_id ?? '');
    if (notifyAppId && notifyAppId !== cfg.appId) {
      throw domainError(
        ERROR_CODES.PAYMENT_CALLBACK_INVALID,
        'Alipay notification app_id mismatch',
        400,
        { expected: cfg.appId, received: notifyAppId },
      );
    }

    // seller_id 校验（如配置中指定了 seller_id）。
    const notifySellerId = String(params.seller_id ?? '');
    if (cfg.sellerId && notifySellerId && notifySellerId !== cfg.sellerId) {
      throw domainError(
        ERROR_CODES.PAYMENT_CALLBACK_INVALID,
        'Alipay notification seller_id mismatch',
        400,
        { expected: cfg.sellerId, received: notifySellerId },
      );
    }

    // P2-1: notify_time 有效期校验（防重放攻击）。
    // 支付宝异步通知的 notify_time 格式为 yyyy-MM-dd HH:mm:ss（Asia/Shanghai 时区）。
    // 如果通知时间距今超过 30 分钟，记录警告但不拒绝——因为支付宝重试机制可能导致延迟通知，
    // 拒绝会导致合法支付无法入账。订单状态和金额校验仍作为额外保护。
    const notifyTimeRaw = String(params.notify_time ?? '');
    if (notifyTimeRaw) {
      // 兼容 iOS Safari 不支持 yyyy-MM-dd HH:mm:ss 格式的 Date 解析：替换 - 为 /。
      const notifyDate = new Date(notifyTimeRaw.replace(/-/g, '/'));
      if (!Number.isNaN(notifyDate.getTime())) {
        const now = Date.now();
        const diffMinutes = (now - notifyDate.getTime()) / 1000 / 60;
        if (Math.abs(diffMinutes) > 30) {
          // 通知超时或时钟偏移过大，记录警告但不阻断入账。
          // 使用 console.warn 而非 logger，因为 adapter 是纯领域包不依赖 NestJS logger。
          console.warn(
            `[Alipay] notification notify_time exceeds 30min window: notify_time=${notifyTimeRaw}, diff=${diffMinutes.toFixed(1)}min`,
          );
        }
      }
    }

    const tradeStatus = String(params.trade_status ?? '');
    const status: PaymentNotification['status'] =
      tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED' ? 'success' : 'failed';
    const amountCents = Math.round(Number(params.total_amount ?? 0) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Alipay notification invalid total_amount', 400);
    }

    return {
      orderId: String(params.out_trade_no),
      tradeNo: String(params.trade_no ?? params.out_trade_no),
      amountCents,
      status,
      // P2 修复：回传 notify_id/seller_id/app_id 等字段供 service 层审计落库。
      raw: { ...params },
    };
  }

  async queryPayment(tradeNo: string, orderId: string): Promise<PaymentQueryResult> {
    const bizContent: Record<string, unknown> = { out_trade_no: orderId };
    if (tradeNo) bizContent.trade_no = tradeNo;
    const resp = await this.invokeGateway('alipay.trade.query', bizContent);
    const data = resp.alipay_trade_query_response as Record<string, unknown>;
    if (!data) {
      throw domainError(ERROR_CODES.PROVIDER_UPSTREAM_ERROR, 'Alipay query response missing payload', 502, resp);
    }
    const tradeStatus = String(data.trade_status ?? '');
    const status: PaymentQueryResult['status'] = mapAlipayTradeStatus(tradeStatus);
    return {
      status,
      amountCents: Math.round(Number(data.total_amount ?? 0) * 100),
      tradeNo: String(data.trade_no ?? orderId),
      raw: data,
    };
  }

  async closePayment(orderId: string): Promise<void> {
    const bizContent: Record<string, unknown> = { out_trade_no: orderId };
    await this.invokeGateway('alipay.trade.close', bizContent);
  }

  /**
   * 调用支付宝网关（POST form）：
   * 1. 组装公共参数 + biz_content。
   * 2. 对排序后的 query string 做 RSA-SHA256 签名。
   * 3. fetch 发起请求，解析 alipay.*_response 段。
   */
  private async invokeGateway(
    method: string,
    bizContent: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const cfg = this.requireConfig();
    this.loadPrivateKey();

    const params = this.buildSignedParams({
      app_id: cfg.appId,
      method,
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: alipayTimestamp(new Date()),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
    });

    const resp = await fetch(cfg.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: params,
    });
    if (!resp.ok) {
      throw domainError(
        ERROR_CODES.PROVIDER_UPSTREAM_ERROR,
        `Alipay gateway HTTP ${resp.status} for ${method}`,
        502,
        { method, status: resp.status },
      );
    }
    const text = await resp.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // 极少数情况会返回 form-encoded；按 form 解析后包裹一层。
      const form = parseFormBody(text);
      json = { ...(form as Record<string, unknown>) };
    }
    return json;
  }

  /**
   * 组装 + 签名参数，返回 URL-encoded query string（已含 sign），可作跳转 URL 或 form body。
   *
   * 关键：签名串必须用**原始值**按 `key=value` 直接拼接（与官方 alipay-sdk-java
   * `AlipaySignature.getSignContent` 一致），**不要**对值 URL-encode 后再签名。
   * 传输层（redirect URL / form body）再对每个参数做 alipayEncode 编码。
   *
   * 若对值先编码再签名，含中文 subject / passback_params / 空格等字符时，签名串与
   * 支付宝侧按原始值重算的串不一致 → 网关验签失败（P1 红队修复）。
   */
  private buildSignedParams(input: Record<string, string>): string {
    this.requireConfig(); // 仅用于触发配置校验，参数本身已组装好
    const sortedKeys = Object.keys(input).sort();
    // 签名用原始值拼接（不编码）。
    const signingString = sortedKeys.map((k) => `${k}=${input[k]}`).join('&');
    const sign = createSign('RSA-SHA256').update(signingString, 'utf8').sign(this.loadPrivateKey(), 'base64');
    // 传输层再对 key/value 编码。
    const pairs = sortedKeys.map((k) => `${alipayEncode(k)}=${alipayEncode(input[k])}`);
    pairs.push(`sign=${alipayEncode(sign)}`);
    return pairs.join('&');
  }
}

/* ----------------------------- helpers ----------------------------- */

/**
 * 规范化 PEM：补齐 header/footer，兼容单行裸 base64。
 *
 * P2 修复：增强 PEM 容错解析。
 * - 同时替换转义的 `\\n` 和实际 `\n`（旧代码只替换 `\\n`）。
 * - header/footer 检查大小写不敏感（旧代码只匹配 `-----BEGIN`）。
 * - 兼容 PKCS#1 (`BEGIN RSA PRIVATE KEY`) 和 PKCS#8 (`BEGIN PRIVATE KEY`)。
 */
function normalizePem(key: string): string {
  // 先统一处理换行符：替换转义的 \\n 为实际换行，再 trim。
  const trimmed = key.replace(/\\n/g, '\n').trim();
  // 大小写不敏感检查 PEM header。
  if (/-----BEGIN[^-]*-----/i.test(trimmed)) {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  }
  // 单行裸 base64（无 header/footer） → 包成 PKCS#8 PEM。
  // 去除可能的空白和换行后重新分块。
  const singleLine = trimmed.replace(/\s+/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${chunk(singleLine, 64)}\n-----END PRIVATE KEY-----\n`;
}

function chunk(s: string, size: number): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.join('\n');
}

/** Alipay 时间戳格式：yyyy-MM-dd HH:mm:ss（本地时区，Alipay 默认 Asia/Shanghai）。 */
function alipayTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Alipay URL 编码：RFC 3986 + 不残留 `+`（与官方 Java SDK 一致）。 */
function alipayEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/~/g, '%7E')
    .replace(/\+/g, '%2B');
}

/**
 * 构造用于验签的 string：除 sign/sign_type 外的参数按 key 排序，用**解码后的原始值**以 & 连接。
 *
 * 与官方 `AlipaySignature.rsaCheckV1` 一致：值不重新 URL-encode。
 * 若重新 encode，含空格（notify_time）/ 冒号 / 中文（subject）等字符时，与支付宝按原始值
 * 重算的串不一致 → 合法通知验签失败（P1 红队修复）。
 */
function buildAlipaySignedString(params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .sort();
  return keys.map((k) => `${k}=${params[k]}`).join('&');
}

/** 解析 form-encoded body（含 application/x-www-form-urlencoded）。 */
function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body) return out;
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const key = idx >= 0 ? pair.slice(0, idx) : pair;
    const val = idx >= 0 ? pair.slice(idx + 1) : '';
    out[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(val.replace(/\+/g, ' '));
  }
  return out;
}

function centsToYuan(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw domainError(ERROR_CODES.VALIDATION_ERROR, 'amountCents must be a non-negative integer', 400);
  }
  return (cents / 100).toFixed(2);
}

function mapAlipayTradeStatus(s: string): PaymentQueryResult['status'] {
  switch (s) {
    case 'TRADE_SUCCESS':
    case 'TRADE_FINISHED':
      return 'success';
    case 'WAIT_BUYER_PAY':
      return 'pending';
    case 'TRADE_CLOSED':
      return 'closed';
    default:
      return 'failed';
  }
}
