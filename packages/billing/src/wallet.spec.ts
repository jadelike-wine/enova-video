import { describe, expect, it } from 'vitest';
import { computeRelease, computeReserve, computeSettle } from './wallet';

describe('computeReserve', () => {
  it('reserves credits when sufficient', () => {
    expect(computeReserve(100, 0, 80)).toEqual({ ok: true, balanceAfter: 20, reservedAfter: 80 });
  });

  it('rejects when balance is insufficient (prevent oversell)', () => {
    expect(computeReserve(50, 0, 80)).toEqual({ ok: false, balanceAfter: 50, reservedAfter: 0 });
  });

  it('reserved credits do not count toward available balance', () => {
    // 可用余额 100，已预留 50；再预留 120 会超卖 → 拒绝
    expect(computeReserve(100, 50, 120)).toEqual({ ok: false, balanceAfter: 100, reservedAfter: 50 });
  });

  it('allows exact balance depletion', () => {
    expect(computeReserve(80, 0, 80)).toEqual({ ok: true, balanceAfter: 0, reservedAfter: 80 });
  });
});

describe('computeSettle', () => {
  it('settles actual and releases the remainder', () => {
    // reserved 80, actual 65 → released 15
    expect(computeSettle(20, 80, 65)).toEqual({ reservedAfter: 0, released: 15 });
  });

  it('releases nothing when actual equals reserved', () => {
    expect(computeSettle(20, 80, 80)).toEqual({ reservedAfter: 0, released: 0 });
  });

  it('caps actual at reserved (never over-settle)', () => {
    expect(computeSettle(20, 80, 999)).toEqual({ reservedAfter: 0, released: 0 });
  });
});

describe('computeRelease', () => {
  it('releases all reserved back to balance on failure', () => {
    expect(computeRelease(20, 80)).toEqual({ balanceAfter: 100, reservedAfter: 0, released: 80 });
  });
});

describe('reserve → settle/release invariant', () => {
  it('never lets balance go negative and always reconciles', () => {
    // 余额 100，reserve 80 → available 20
    const r = computeReserve(100, 0, 80);
    expect(r).toEqual({ ok: true, balanceAfter: 20, reservedAfter: 80 });

    // 成功 65：settle 65 + release 15 → 最终 balance = 20 + 15 = 35
    const s = computeSettle(r.balanceAfter, r.reservedAfter, 65);
    expect(s.released).toBe(15);
    expect(20 + s.released).toBe(35);

    // 失败：release 80 → balance 回到 100
    const rel = computeRelease(r.balanceAfter, r.reservedAfter);
    expect(rel.balanceAfter).toBe(100);
  });
});