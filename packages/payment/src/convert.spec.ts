import { describe, expect, it } from 'vitest';
import { creditsFromCents } from './convert';

describe('creditsFromCents', () => {
  it('converts cents to credits at 1 CNY = 100 credits', () => {
    // 10 元 = 1000 分 → 1000 / 100 * 100 = 1000 credits
    expect(creditsFromCents(1000, 100)).toBe(1000);
  });

  it('floors fractional credits (never over-issue)', () => {
    // 1 元 50 分 = 150 分 → 150 * 100 / 100 = 150 (exact)
    expect(creditsFromCents(150, 100)).toBe(150);
    // 1 分 * 100 / 100 = 1
    expect(creditsFromCents(1, 100)).toBe(1);
    // 小额 + 低汇率向下取整：1 分 * 10 / 100 = 0.1 → floor 0
    expect(creditsFromCents(1, 10)).toBe(0);
  });

  it('handles zero amount', () => {
    expect(creditsFromCents(0, 100)).toBe(0);
  });

  it('rejects invalid amountCents', () => {
    expect(() => creditsFromCents(-1, 100)).toThrow('amountCents must be a non-negative integer');
    expect(() => creditsFromCents(10.5 as number, 100)).toThrow('amountCents must be a non-negative integer');
  });

  it('rejects invalid rate', () => {
    expect(() => creditsFromCents(100, 0)).toThrow('creditsPerCny must be a positive integer');
    expect(() => creditsFromCents(100, -5)).toThrow('creditsPerCny must be a positive integer');
  });
});