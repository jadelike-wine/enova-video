import { describe, expect, it } from 'vitest';
import { computeCapture, computeReleaseForJob, computeReserve } from '@enova/billing';

describe('computeReserve', () => {
  it('reserves credits when sufficient', () => {
    expect(computeReserve(100, 0, 80)).toEqual({ ok: true, balanceAfter: 20, reservedAfter: 80 });
  });

  it('rejects when balance is insufficient (prevent oversell)', () => {
    expect(computeReserve(50, 0, 80)).toEqual({ ok: false, balanceAfter: 50, reservedAfter: 0 });
  });

  it('reserved credits do not count toward available balance', () => {
    expect(computeReserve(100, 50, 120)).toEqual({ ok: false, balanceAfter: 100, reservedAfter: 50 });
  });

  it('allows exact balance depletion', () => {
    expect(computeReserve(80, 0, 80)).toEqual({ ok: true, balanceAfter: 0, reservedAfter: 80 });
  });
});

describe('computeCapture (per-job settle)', () => {
  it('captures actual and releases the remainder', () => {
    // reserved 80, actual 65 → capture 65, release 15
    const r = computeCapture(80, 0, 0, 65);
    expect(r.captureAmount).toBe(65);
    expect(r.releaseAmount).toBe(15);
  });

  it('releases nothing when actual equals reserved', () => {
    expect(computeCapture(80, 0, 0, 80).releaseAmount).toBe(0);
  });

  it('caps actual at reserved (never over-settle)', () => {
    expect(computeCapture(80, 0, 0, 999).captureAmount).toBe(80);
  });
});

describe('computeReleaseForJob (per-job release)', () => {
  it('releases all reserved back to balance on failure', () => {
    expect(computeReleaseForJob(80, 0, 0).releaseAmount).toBe(80);
  });
});

describe('reserve → capture/release invariant', () => {
  it('never lets balance go negative and always reconciles', () => {
    // 余额 100，reserve 80 → available 20
    const r = computeReserve(100, 0, 80);
    expect(r).toEqual({ ok: true, balanceAfter: 20, reservedAfter: 80 });

    // 成功 65：capture 65 + release 15 → 最终 balance = 20 + 15 = 35
    const s = computeCapture(80, 0, 0, 65);
    expect(s.releaseAmount).toBe(15);
    expect(20 + s.releaseAmount).toBe(35);

    // 失败：release 80 → balance 回到 100
    const rel = computeReleaseForJob(80, 0, 0);
    expect(20 + rel.releaseAmount).toBe(100);
  });
});
