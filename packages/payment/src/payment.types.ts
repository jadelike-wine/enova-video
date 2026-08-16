/**
 * 支付领域类型（Phase 7）。
 * 设计参考 sub2api 的 Provider 抽象，但仅保留充值闭环所需的最小契约。
 *
 * 金额单位规约：
 * - 所有支付金额一律用「分」表示（整数，人民币），禁止浮点。
 * - credits 为整数。金额↔credits 换算见 convert.ts，由配置的汇率驱动。
 */

/** 支付渠道 key。 */
export const PAYMENT_PROVIDERS = {
  ALIPAY: 'alipay',
  WECHAT: 'wechat',
  SANDBOX: 'sandbox',
} as const;
export type PaymentProviderKey = (typeof PAYMENT_PROVIDERS)[keyof typeof PAYMENT_PROVIDERS];

/** 支付模式：sandbox=本地演示（无商户密钥）；alipay/wechat=真实渠道。 */
export const PAYMENT_MODES = {
  SANDBOX: 'sandbox',
  ALIPAY: 'alipay',
  WECHAT: 'wechat',
} as const;
export type PaymentMode = (typeof PAYMENT_MODES)[keyof typeof PAYMENT_MODES];

/** 发起支付请求。 */
export interface CreatePaymentRequest {
  /** 内部订单号（商户单号 out_trade_no）。 */
  orderId: string;
  /** 支付金额（分，整数）。 */
  amountCents: number;
  /** 商品描述。 */
  subject: string;
  /** 异步通知回调地址。 */
  notifyUrl: string;
  /** 支付完成后的页面跳转地址。 */
  returnUrl?: string;
  clientIp?: string;
}

/** 发起支付的结果。 */
export interface CreatePaymentResult {
  /** 第三方交易号。 */
  tradeNo: string;
  /** 跳转支付 URL（H5/收银台）。 */
  payUrl?: string;
  /** 二维码内容（扫码支付）。 */
  qrCode?: string;
}

/** 回调验签上下文：供渠道适配器构造验签串使用（如 WeChat APIv3 需要 method + url）。 */
export interface NotificationContext {
  /** HTTP method（大写，如 POST）。 */
  method?: string;
  /** 请求路径（含 query string，如 /api/v1/payment/notify/wechat）。 */
  url?: string;
}

/** 回调通知解析结果（已验签）。status 归一到 success/failed。 */
export interface PaymentNotification {
  /** 第三方交易号。 */
  tradeNo: string;
  /** 商户订单号 out_trade_no → 内部订单 id。 */
  orderId: string;
  /** 实际支付金额（分）。 */
  amountCents: number;
  status: 'success' | 'failed';
  /** 原始回调体（用于审计落库）。 */
  raw: Record<string, unknown>;
}

/** 渠道订单查询结果。status 归一到 pending/success/failed/closed。 */
export interface PaymentQueryResult {
  status: 'pending' | 'success' | 'failed' | 'closed';
  amountCents: number;
  tradeNo: string;
  /** 原始响应体（用于审计）。 */
  raw?: Record<string, unknown>;
}

/**
 * 支付渠道适配器接口。
 * 各渠道实现自己的下单与回调验签；未配置商户密钥时应在 createPayment 抛出清晰错误。
 *
 * 产品策略：Enova Video 当前不支持任何自动退款，因此契约不包含 refund/queryRefund。
 * 退款仅允许运营人员线下通过支付宝/微信商户平台人工处理，不进入本自动账务系统。
 */
export interface PaymentProvider {
  key: PaymentProviderKey;
  name: string;
  createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult>;
  /**
   * 解析并验签异步通知。返回 null 表示该回调与本渠道无关（调用方应返回 200 忽略）。
   * 验签失败应抛出 PAYMENT_CALLBACK_INVALID。
   */
  verifyNotification(
    rawBody: string,
    headers: Record<string, string>,
    context?: NotificationContext,
  ): Promise<PaymentNotification | null>;
  /** 查询渠道订单状态。tradeNo 可选，至少传 orderId。 */
  queryPayment(tradeNo: string, orderId: string): Promise<PaymentQueryResult>;
  /** 关闭/取消未支付订单。 */
  closePayment(orderId: string): Promise<void>;
}

/** 支付渠道适配器配置（各渠道从 config env 注入）。 */
export interface PaymentProviderConfig {
  /** 支付完成后的页面跳转基础地址（公网）。 */
  returnBaseUrl: string;
  notifyUrl: string;
}

/** 支付宝真实渠道配置（缺任一项视为未配置）。 */
export interface AlipayConfig {
  appId: string;
  privateKey: string;
  publicKey: string;
  gateway: string;
  /** 可选：卖家 PID（seller_id），配置后异步通知会做字段级校验。 */
  sellerId?: string;
}

/** 微信支付（APIv3）真实渠道配置（缺任一项视为未配置）。 */
export interface WechatConfig {
  appId: string;
  mchId: string;
  apiV3Key: string;
  /** 商户证书序列号（用于 Authorization header 的 serial_no）。 */
  serialNo: string;
  /** 商户私钥（PEM，PKCS#8 或 PKCS#1）。 */
  privateKey: string;
  /**
   * 微信支付平台证书（PEM），用于 webhook 签名验签。
   * 生产环境必须配置：可通过 GET /v3/certificates 拉取并定期轮换。
   * 未配置时 verifyNotification 直接抛 PAYMENT_CALLBACK_INVALID。
   */
  platformCert?: string;
}

/** 由共享 env 映射出的支付模块配置（API 组装注入）。 */
export interface PaymentEnvConfig {
  mode: PaymentMode;
  /** 1 元可兑换的 credits 数（整数）。 */
  creditsPerCny: number;
  /** 单笔最小充值金额（分）。 */
  minRechargeCents: number;
  returnBaseUrl: string;
  notifyUrl: string;
  alipay?: AlipayConfig;
  wechat?: WechatConfig;
  /** BUG-004: sandbox 回调鉴权密钥；配置后 sandbox notify 必须携带 X-Sandbox-Secret。 */
  sandboxSecret?: string;
}