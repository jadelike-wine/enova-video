import { describe, expect, it } from 'vitest'
import { canConfirmSandboxPayment } from './payment-result'

describe('canConfirmSandboxPayment', () => {
  it('only exposes manual confirmation for sandbox orders', () => {
    expect(canConfirmSandboxPayment({ channel: 'sandbox' })).toBe(true)
    expect(canConfirmSandboxPayment({ channel: 'alipay' })).toBe(false)
    expect(canConfirmSandboxPayment({ channel: 'wechat' })).toBe(false)
  })
})
