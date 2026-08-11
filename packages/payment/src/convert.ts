import { domainError, ERROR_CODES } from '@enova/contracts';

/**
 * 金额 ↔ credits 换算纯函数（无副作用，便于单测）。
 *
 * 单位规约：
 * - 支付金额一律为「分」（整数，人民币）。
 * - credits 为整数。
 * - 汇率由配置的「1 元可兑换 credits 数」驱动（整数），换算用整数优先、向下取整，避免浮点累计误差。
 */

/** 金额（分，人民币）→ credits。amountCents 存在时永远返回非负整数。 */
export function creditsFromCents(amountCents: number, creditsPerCny: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw domainError(ERROR_CODES.VALIDATION_ERROR, 'amountCents must be a non-negative integer', 400);
  }
  if (!Number.isInteger(creditsPerCny) || creditsPerCny <= 0) {
    throw domainError(ERROR_CODES.VALIDATION_ERROR, 'creditsPerCny must be a positive integer', 400);
  }
  // 元 = 分 / 100；credits = 元 * creditsPerCny。整数化运算后向下取整。
  return Math.floor((amountCents * creditsPerCny) / 100);
}