import { randomUUID } from 'node:crypto';
import { domainError, ERROR_CODES } from '@enova/contracts';
import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentNotification,
  PaymentProvider,
  PaymentProviderConfig,
  PaymentQueryResult,
} from '../payment.types.js';

/**
 * 沙箱支付适配器：本地演示用，无需商户密钥。
 * - createPayment：直接返回虚拟交易号 + 模拟支付页地址。
 * - verifyNotification：解析沙箱回调体（JSON），不做真实签名校验。
 * - queryPayment / closePayment：返回 mock 数据，无真实副作用。
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly key = 'sandbox' as const;
  readonly name = 'Sandbox';

  constructor(private readonly config: PaymentProviderConfig) {}

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const tradeNo = `SANDBOX-${req.orderId}-${randomUUID().slice(0, 8)}`;
    return {
      tradeNo,
      payUrl: `${this.config.returnBaseUrl}/pay/sandbox/${req.orderId}`,
    };
  }

  /**
   * 解析沙箱异步通知。回调体形如：
   * `{ "orderId": "...", "tradeNo": "...", "amountCents": 100, "status": "success" }`
   * 沙箱模式下视为已由调用方（模拟端点）预置，仅做结构解析。
   */
  async verifyNotification(
    rawBody: string,
    _headers: Record<string, string>,
  ): Promise<PaymentNotification | null> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Invalid sandbox notification body', 400);
    }
    if (typeof data.orderId !== 'string' || typeof data.tradeNo !== 'string') {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Sandbox notification missing orderId/tradeNo', 400);
    }
    const amountCents = Number(data.amountCents);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw domainError(ERROR_CODES.PAYMENT_CALLBACK_INVALID, 'Sandbox notification invalid amountCents', 400);
    }
    return {
      orderId: data.orderId,
      tradeNo: data.tradeNo,
      amountCents,
      status: data.status === 'success' ? 'success' : 'failed',
      raw: data,
    };
  }

  /**
   * 沙箱查单：永远返回 success，金额与订单金额无关（mock）。
   * tradeNo 用 orderId 作为占位，与 createPayment 行为一致。
   */
  async queryPayment(tradeNo: string, orderId: string): Promise<PaymentQueryResult> {
    if (!orderId) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'Sandbox queryPayment requires orderId', 400);
    }
    return {
      status: 'success',
      amountCents: 0,
      tradeNo: tradeNo || orderId,
      raw: { sandbox: true, orderId, tradeNo },
    };
  }

  /** 沙箱关单：no-op。 */
  async closePayment(_orderId: string): Promise<void> {
    /* no-op for sandbox */
  }
}