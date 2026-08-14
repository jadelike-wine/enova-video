import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { computeCapture, computeReleaseForJob, computeReserve, WalletGateway } from './wallet';
import { ERROR_CODES } from '@enova/contracts';
import {
  wallets as walletsTable,
  walletLedger as ledgerTable,
} from '@enova/db';

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

// ---------------------------------------------------------------------------
// P0-1: per-job capture/release 纯函数测试
// ---------------------------------------------------------------------------

describe('computeCapture (per-job)', () => {
  it('captures actual and releases the remainder', () => {
    // reserved 80, captured 0, released 0, actual 65 → capture 65, release 15
    const r = computeCapture(80, 0, 0, 65);
    expect(r.captureAmount).toBe(65);
    expect(r.releaseAmount).toBe(15);
    expect(r.newCaptured).toBe(65);
    expect(r.newReleased).toBe(15);
    expect(r.remaining).toBe(80);
  });

  it('releases nothing when actual equals reserved', () => {
    const r = computeCapture(80, 0, 0, 80);
    expect(r.captureAmount).toBe(80);
    expect(r.releaseAmount).toBe(0);
  });

  it('caps actual at remaining (never over-settle)', () => {
    const r = computeCapture(80, 0, 0, 999);
    expect(r.captureAmount).toBe(80);
    expect(r.releaseAmount).toBe(0);
  });

  it('captures 0 when actual is 0 (full release)', () => {
    const r = computeCapture(80, 0, 0, 0);
    expect(r.captureAmount).toBe(0);
    expect(r.releaseAmount).toBe(80);
    expect(r.newCaptured).toBe(0);
    expect(r.newReleased).toBe(80);
  });

  it('handles negative actual as 0', () => {
    const r = computeCapture(80, 0, 0, -10);
    expect(r.captureAmount).toBe(0);
    expect(r.releaseAmount).toBe(80);
  });

  it('respects already-captured credits', () => {
    // reserved 80, already captured 30 → remaining 50, actual 40 → capture 40, release 10
    const r = computeCapture(80, 30, 0, 40);
    expect(r.remaining).toBe(50);
    expect(r.captureAmount).toBe(40);
    expect(r.releaseAmount).toBe(10);
    expect(r.newCaptured).toBe(70);
    expect(r.newReleased).toBe(10);
  });

  it('respects already-released credits', () => {
    // reserved 80, already released 20 → remaining 60, actual 50 → capture 50, release 10
    const r = computeCapture(80, 0, 20, 50);
    expect(r.remaining).toBe(60);
    expect(r.captureAmount).toBe(50);
    expect(r.releaseAmount).toBe(10);
  });

  it('returns 0 capture/release when fully consumed', () => {
    // reserved 80, captured 80 → remaining 0
    const r = computeCapture(80, 80, 0, 50);
    expect(r.remaining).toBe(0);
    expect(r.captureAmount).toBe(0);
    expect(r.releaseAmount).toBe(0);
  });
});

describe('computeReleaseForJob (per-job)', () => {
  it('releases all remaining back to balance on failure', () => {
    const r = computeReleaseForJob(80, 0, 0);
    expect(r.releaseAmount).toBe(80);
    expect(r.newReleased).toBe(80);
    expect(r.remaining).toBe(80);
  });

  it('only releases remaining (not already-captured)', () => {
    // reserved 80, captured 30 → remaining 50
    const r = computeReleaseForJob(80, 30, 0);
    expect(r.releaseAmount).toBe(50);
    expect(r.newReleased).toBe(50);
  });

  it('respects already-released credits', () => {
    // reserved 80, released 20 → remaining 60
    const r = computeReleaseForJob(80, 0, 20);
    expect(r.releaseAmount).toBe(60);
    expect(r.newReleased).toBe(80);
  });

  it('returns 0 when fully consumed', () => {
    const r = computeReleaseForJob(80, 80, 0);
    expect(r.releaseAmount).toBe(0);
  });

  it('returns 0 when fully released', () => {
    const r = computeReleaseForJob(80, 0, 80);
    expect(r.releaseAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P0-1 核心不变量：两个并发 reservation 互不干扰
// ---------------------------------------------------------------------------

describe('P0-1: concurrent reservation isolation', () => {
  it('Job A release does NOT affect Job B reservation', () => {
    // Wallet: balance=500, reserved=0
    // Job A reserves 100, Job B reserves 200

    // Job A reserve
    const reserveA = computeReserve(500, 0, 100);
    expect(reserveA).toEqual({ ok: true, balanceAfter: 400, reservedAfter: 100 });

    // Job B reserve (after A)
    const reserveB = computeReserve(reserveA.balanceAfter, reserveA.reservedAfter, 200);
    expect(reserveB).toEqual({ ok: true, balanceAfter: 200, reservedAfter: 300 });

    // Job A fails → release ONLY Job A's 100
    const releaseA = computeReleaseForJob(100, 0, 0); // Job A's reservation
    expect(releaseA.releaseAmount).toBe(100);

    // Simulate wallet update: balance += 100, reservedBalance -= 100
    const walletAfterARelease = {
      balance: reserveB.balanceAfter + releaseA.releaseAmount, // 200 + 100 = 300
      reserved: reserveB.reservedAfter - releaseA.releaseAmount, // 300 - 100 = 200
    };
    expect(walletAfterARelease).toEqual({ balance: 300, reserved: 200 });

    // Job B's reservation is STILL 200 (not wiped!)
    // Job B captures 200
    const captureB = computeCapture(200, 0, 0, 200);
    expect(captureB.captureAmount).toBe(200);
    expect(captureB.releaseAmount).toBe(0);

    // Final wallet: balance = 300 (Job B's 200 was already deducted at reserve time)
    // reserved = 200 - 200 = 0
    const finalWallet = {
      balance: walletAfterARelease.balance, // 300 (no change from capture - credits already deducted)
      reserved: walletAfterARelease.reserved - captureB.remaining, // 200 - 200 = 0
    };
    expect(finalWallet).toEqual({ balance: 300, reserved: 0 });

    // Total credits consumed: Job A = 0 (failed), Job B = 200
    // Initial balance was 500, final is 300 → consumed 200. Correct!
    expect(500 - finalWallet.balance).toBe(200);
  });

  it('Job A capture does NOT affect Job B reservation', () => {
    // Wallet: balance=500, reserved=0
    const reserveA = computeReserve(500, 0, 100);
    const reserveB = computeReserve(reserveA.balanceAfter, reserveA.reservedAfter, 200);

    // Job A succeeds with actual=80 (capture 80, release 20)
    const captureA = computeCapture(100, 0, 0, 80);
    expect(captureA.captureAmount).toBe(80);
    expect(captureA.releaseAmount).toBe(20);

    // Wallet after A capture: balance += 20 (unused), reserved -= 100 (A's full reservation)
    const walletAfterACapture = {
      balance: reserveB.balanceAfter + captureA.releaseAmount, // 200 + 20 = 220
      reserved: reserveB.reservedAfter - 100, // 300 - 100 = 200
    };
    expect(walletAfterACapture).toEqual({ balance: 220, reserved: 200 });

    // Job B's reservation is STILL 200
    // Job B fails → release 200
    const releaseB = computeReleaseForJob(200, 0, 0);
    expect(releaseB.releaseAmount).toBe(200);

    const finalWallet = {
      balance: walletAfterACapture.balance + releaseB.releaseAmount, // 220 + 200 = 420
      reserved: walletAfterACapture.reserved - releaseB.releaseAmount, // 200 - 200 = 0
    };
    expect(finalWallet).toEqual({ balance: 420, reserved: 0 });

    // Total consumed: Job A = 80, Job B = 0 (failed)
    // Initial 500, final 420 → consumed 80. Correct!
    expect(500 - finalWallet.balance).toBe(80);
  });

  it('three concurrent jobs: partial capture + release + capture', () => {
    // Wallet: balance=1000
    // Job A: reserve 100, capture 80
    // Job B: reserve 200, release (fail)
    // Job C: reserve 300, capture 300

    const rA = computeReserve(1000, 0, 100);
    const rB = computeReserve(rA.balanceAfter, rA.reservedAfter, 200); // bal=700, res=300
    const rC = computeReserve(rB.balanceAfter, rB.reservedAfter, 300); // bal=400, res=600

    // Job A captures 80 (release 20)
    const cA = computeCapture(100, 0, 0, 80);
    // wallet: bal=400+20=420, res=600-100=500
    let balance = rC.balanceAfter + cA.releaseAmount;
    let reserved = rC.reservedAfter - 100;
    expect(balance).toBe(420);
    expect(reserved).toBe(500);

    // Job B releases 200
    const rB_rel = computeReleaseForJob(200, 0, 0);
    // wallet: bal=420+200=620, res=500-200=300
    balance += rB_rel.releaseAmount;
    reserved -= rB_rel.releaseAmount;
    expect(balance).toBe(620);
    expect(reserved).toBe(300);

    // Job C captures 300 (release 0)
    const cC = computeCapture(300, 0, 0, 300);
    // wallet: bal=620+0=620, res=300-300=0
    balance += cC.releaseAmount;
    reserved -= cC.remaining;
    expect(balance).toBe(620);
    expect(reserved).toBe(0);

    // Total consumed: A=80, B=0, C=300 → 380
    expect(1000 - balance).toBe(380);
  });
});

describe('P0-1: idempotency invariants', () => {
  it('duplicate capture is safe (captureAmount=0 on second call)', () => {
    // First capture: reserved 80, actual 65 → capture 65, release 15
    const first = computeCapture(80, 0, 0, 65);
    expect(first.captureAmount).toBe(65);
    expect(first.newCaptured).toBe(65);
    expect(first.newReleased).toBe(15);

    // Second capture (after first): remaining = 80 - 65 - 15 = 0
    const second = computeCapture(80, first.newCaptured, first.newReleased, 65);
    expect(second.remaining).toBe(0);
    expect(second.captureAmount).toBe(0);
    expect(second.releaseAmount).toBe(0);
  });

  it('duplicate release is safe (releaseAmount=0 on second call)', () => {
    // First release: reserved 80 → release 80
    const first = computeReleaseForJob(80, 0, 0);
    expect(first.releaseAmount).toBe(80);
    expect(first.newReleased).toBe(80);

    // Second release (after first): remaining = 80 - 0 - 80 = 0
    const second = computeReleaseForJob(80, 0, first.newReleased);
    expect(second.releaseAmount).toBe(0);
  });

  it('release after partial capture only releases remaining', () => {
    // Capture 65 of 80, then release the rest
    const capture = computeCapture(80, 0, 0, 65);
    expect(capture.captureAmount).toBe(65);
    expect(capture.releaseAmount).toBe(15);

    // After capture, remaining = 0 (capture releases the unused portion)
    // If we then try to release:
    const release = computeReleaseForJob(80, capture.newCaptured, capture.newReleased);
    expect(release.remaining).toBe(0);
    expect(release.releaseAmount).toBe(0);
  });

  it('capture after release returns 0 (already released)', () => {
    // Release first
    const release = computeReleaseForJob(80, 0, 0);
    expect(release.releaseAmount).toBe(80);
    expect(release.newReleased).toBe(80);

    // Then try to capture: remaining = 0
    const capture = computeCapture(80, 0, release.newReleased, 50);
    expect(capture.remaining).toBe(0);
    expect(capture.captureAmount).toBe(0);
  });
});

describe('P0-1: insufficient credits', () => {
  it('rejects reserve when balance < credits', () => {
    const r = computeReserve(50, 0, 100);
    expect(r.ok).toBe(false);
    expect(r.balanceAfter).toBe(50); // unchanged
  });

  it('rejects second reserve when remaining balance insufficient', () => {
    // balance 100, reserve 80 → balance 20
    const r1 = computeReserve(100, 0, 80);
    expect(r1.ok).toBe(true);

    // Try to reserve 50 with only 20 available
    const r2 = computeReserve(r1.balanceAfter, r1.reservedAfter, 50);
    expect(r2.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// refundCreditsInTx: real behavior tests with table-aware mock DB
// ---------------------------------------------------------------------------

/**
 * Creates a mock DB that simulates Drizzle's transaction + query builder
 * with table-aware select, update, insert — enough to test refundCreditsInTx.
 */
function createMockTxWallet(config: { wallet: any; ledger: any[] }) {
  const store = {
    wallet: { ...config.wallet },
    ledger: [...config.ledger],
  };
  const insertedLedger: any[] = [];
  let walletUpdated = false;
  let walletUpdateValue: any = null;
  let forUpdateCalled = false;

  /**
   * Resolve data by table, optionally filtering by the where clause.
   * Supports simple `eq(column, value)` and `and(eq(...), eq(...))` patterns
   * used by refundCreditsInTx idempotency checks.
   */
  const resolveData = (table: unknown, whereArgs?: unknown): any[] => {
    if (table === walletsTable) return [{ ...store.wallet }];
    if (table === ledgerTable) {
      if (!whereArgs) return store.ledger;
      // Recursively search the Drizzle SQL object tree for 'REFUND' value.
      // Drizzle's and(eq(key, val), eq(type, 'REFUND')) creates a deeply nested
      // SQL object with queryChunks arrays. We traverse to find string values.
      // Use a visited Set to handle circular references.
      // Only traverse queryChunks and value properties (SQL condition parts)
      // to avoid walking into column/table schema definitions that contain enum values.
      const visited = new WeakSet();
      const hasRefundFilter = (obj: unknown): boolean => {
        if (obj === 'REFUND') return true;
        if (typeof obj !== 'object' || obj === null) return false;
        if (visited.has(obj as object)) return false;
        visited.add(obj as object);
        // Only traverse queryChunks and value properties (SQL condition parts).
        const queryChunks = (obj as any)?.queryChunks;
        if (Array.isArray(queryChunks)) {
          for (const chunk of queryChunks) {
            if (hasRefundFilter(chunk)) return true;
          }
        }
        const value = (obj as any)?.value;
        if (value === 'REFUND') return true;
        return false;
      };
      if (hasRefundFilter(whereArgs)) {
        return store.ledger.filter((r) => r.type === 'REFUND');
      }
      return store.ledger;
    }
    return [];
  };

  const makeWhere = (table: unknown, data: any[]) => ({
    orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(data)) })),
    limit: vi.fn(() => Promise.resolve(data)),
    for: vi.fn(() => {
      if (table === walletsTable) forUpdateCalled = true;
      return Promise.resolve(data);
    }),
    groupBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(data)) })),
    innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(data)) })) })),
  });

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn((t: unknown) => {
        return {
          where: vi.fn((...args: any[]) => {
            const d = resolveData(t, args[0]);
            return makeWhere(t, d);
          }),
        };
      }),
    })),
    update: vi.fn((t: unknown) => ({
      set: vi.fn((v: any) => ({
        where: vi.fn(() => {
          if (t === walletsTable) {
            walletUpdated = true;
            walletUpdateValue = v;
            Object.assign(store.wallet, v);
          }
          return Promise.resolve();
        }),
      })),
    })),
    insert: vi.fn((t: unknown) => ({
      values: vi.fn((v: any) => {
        // Track insert immediately (Drizzle insert happens on values() call).
        let insertedRec: any = null;
        if (t === ledgerTable) {
          insertedRec = { id: `ledger-${insertedLedger.length + 1}`, ...v };
          insertedLedger.push(insertedRec);
          store.ledger.push(insertedRec);
        }
        // In Drizzle, values() returns a promise that also has .returning().
        const promise = Promise.resolve() as any;
        promise.returning = vi.fn(() => {
          if (insertedRec) return Promise.resolve([insertedRec]);
          return Promise.resolve([{ id: 'x' }]);
        });
        return promise;
      }),
    })),
  };

  const db = {
    transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(tx)),
  };

  return {
    db,
    tx,
    store,
    insertedLedger,
    get walletUpdated() { return walletUpdated; },
    get walletUpdateValue() { return walletUpdateValue; },
    get forUpdateCalled() { return forUpdateCalled; },
  };
}

describe('refundCreditsInTx — real behavior', () => {
  const baseWallet = { id: 'w1', workspaceId: 'ws1', balance: 1000, reservedBalance: 0, updatedAt: new Date() };

  it('locks wallet row with FOR UPDATE', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await gw.refundCreditsInTx(mock.tx as any, 'ws1', 100, 'o1', 'key-1', 'test');
    expect(mock.forUpdateCalled).toBe(true);
  });

  it('correctly decreases wallet balance', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 500 }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    const result = await gw.refundCreditsInTx(mock.tx as any, 'ws1', 200, 'o1', 'key-2', 'test');
    expect(result.balance).toBe(300);
    expect(mock.store.wallet.balance).toBe(300);
    expect(mock.walletUpdated).toBe(true);
  });

  it('writes REFUND ledger with negative amount', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 500 }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await gw.refundCreditsInTx(mock.tx as any, 'ws1', 200, 'o1', 'key-3', 'test refund');
    expect(mock.insertedLedger).toHaveLength(1);
    const entry = mock.insertedLedger[0];
    expect(entry.type).toBe('REFUND');
    expect(entry.amount).toBe(-200);
    expect(entry.amount).toBeLessThan(0);
  });

  it('writes correct workspaceId and orderId', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, workspaceId: 'ws-xyz' }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await gw.refundCreditsInTx(mock.tx as any, 'ws-xyz', 50, 'order-abc', 'key-4', 'test');
    const entry = mock.insertedLedger[0];
    expect(entry.workspaceId).toBe('ws-xyz');
    expect(entry.orderId).toBe('order-abc');
  });

  it('writes correct idempotencyKey', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await gw.refundCreditsInTx(mock.tx as any, 'ws1', 100, 'o1', 'manual-refund:o1:ALI123', 'test');
    expect(mock.insertedLedger[0].idempotencyKey).toBe('manual-refund:o1:ALI123');
  });

  it('writes correct balanceBefore and balanceAfter', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 500 }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await gw.refundCreditsInTx(mock.tx as any, 'ws1', 200, 'o1', 'key-5', 'test');
    const entry = mock.insertedLedger[0];
    expect(entry.balanceBefore).toBe(500);
    expect(entry.balanceAfter).toBe(300);
  });

  it('does NOT update wallet when balance insufficient', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 50 }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await expect(
      gw.refundCreditsInTx(mock.tx as any, 'ws1', 200, 'o1', 'key-6', 'test'),
    ).rejects.toThrow();
    expect(mock.walletUpdated).toBe(false);
    expect(mock.store.wallet.balance).toBe(50);
  });

  it('does NOT insert ledger when balance insufficient', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 50 }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await expect(
      gw.refundCreditsInTx(mock.tx as any, 'ws1', 200, 'o1', 'key-7', 'test'),
    ).rejects.toThrow();
    expect(mock.insertedLedger).toHaveLength(0);
  });

  it('throws NEGATIVE_BALANCE error code when insufficient', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 50 }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    try {
      await gw.refundCreditsInTx(mock.tx as any, 'ws1', 200, 'o1', 'key-8', 'test');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect((err as any).code).toBe(ERROR_CODES.NEGATIVE_BALANCE);
    }
  });

  it('does NOT allow balance to go negative (exact zero is OK)', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 100 }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    const result = await gw.refundCreditsInTx(mock.tx as any, 'ws1', 100, 'o1', 'key-9', 'test');
    expect(result.balance).toBe(0);
    expect(mock.store.wallet.balance).toBe(0);
  });

  it('idempotency: same key does NOT double-deduct', async () => {
    // Pre-existing ledger with the same idempotencyKey
    const existingLedger = [{
      id: 'ledger-existing',
      idempotencyKey: 'key-dup',
      type: 'REFUND',
      amount: -100,
      workspaceId: 'ws1',
      orderId: 'o1',
    }];
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 400 }, ledger: existingLedger });
    const gw = new WalletGateway(mock.db as any);
    const result = await gw.refundCreditsInTx(mock.tx as any, 'ws1', 100, 'o1', 'key-dup', 'test');
    // Should return current balance without deducting again
    expect(result.balance).toBe(400);
    expect(mock.walletUpdated).toBe(false);
    expect(mock.insertedLedger).toHaveLength(0);
  });

  it('idempotency: non-REFUND type with same key does NOT count as already processed', async () => {
    // A non-REFUND ledger with the same idempotencyKey should NOT trigger idempotent skip.
    // The refund should proceed and deduct balance.
    const existingLedger = [{
      id: 'ledger-non-refund',
      idempotencyKey: 'shared-key',
      type: 'ADMIN_ADJUSTMENT', // NOT REFUND
      amount: 50,
      workspaceId: 'ws1',
      orderId: 'o1',
    }];
    const mock = createMockTxWallet({ wallet: { ...baseWallet, balance: 500 }, ledger: existingLedger });
    const gw = new WalletGateway(mock.db as any);
    const result = await gw.refundCreditsInTx(mock.tx as any, 'ws1', 100, 'o1', 'shared-key', 'test');
    // Should proceed with the deduction (not treat as idempotent).
    expect(result.balance).toBe(400);
    expect(mock.walletUpdated).toBe(true);
    expect(mock.insertedLedger).toHaveLength(1);
    expect(mock.insertedLedger[0].type).toBe('REFUND');
  });

  it('rejects non-positive creditsToRevoke', async () => {
    const mock = createMockTxWallet({ wallet: { ...baseWallet }, ledger: [] });
    const gw = new WalletGateway(mock.db as any);
    await expect(
      gw.refundCreditsInTx(mock.tx as any, 'ws1', 0, 'o1', 'key-10', 'test'),
    ).rejects.toThrow(/positive integer/);
    await expect(
      gw.refundCreditsInTx(mock.tx as any, 'ws1', -50, 'o1', 'key-11', 'test'),
    ).rejects.toThrow(/positive integer/);
  });

  it('throws NOT_FOUND when wallet does not exist', async () => {
    // Mock with empty wallet
    const mock = createMockTxWallet({ wallet: null as any, ledger: [] });
    // Override resolveData to return empty for wallets
    mock.tx.select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
          for: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })) as any;
    const gw = new WalletGateway(mock.db as any);
    await expect(
      gw.refundCreditsInTx(mock.tx as any, 'ws-missing', 100, 'o1', 'key-12', 'test'),
    ).rejects.toThrow(/Wallet not found/);
  });
});
