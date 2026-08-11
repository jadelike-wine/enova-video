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

/**
 * 支付渠道适配器接口。
 * 各渠道实现自己的下单与回调验签；未配置商户密钥时应在 createPayment 抛出清晰错误。
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
  ): Promise<PaymentNotification | null>;
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
}

/** 微信支付（APIv3）真实渠道配置（缺任一项视为未配置）。 */
export interface WechatConfig {
  appId: string;
  mchId: string;
  apiV3Key: string;
  serialNo: string;
  privateKey: string;
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
}