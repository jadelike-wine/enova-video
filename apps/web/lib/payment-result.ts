export type PaymentChannel = 'sandbox' | 'alipay' | 'wechat'

export function canConfirmSandboxPayment(result: { channel: PaymentChannel }): boolean {
  return result.channel === 'sandbox'
}
