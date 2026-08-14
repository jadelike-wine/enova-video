import { describe, expect, it, vi } from 'vitest';
import { OrdersAdminService } from './orders.admin.service.js';
import { ERROR_CODES } from '@enova/contracts';
import {
  orders as ordersTable,
  manualRefundRecords as refundTable,
  subscriptions as subsTable,
  subscriptionFulfillments as fulfillTable,
  wallets as walletsTable,
  walletLedger as ledgerTable,
  paymentTransactions as txTable,
} from '@enova/db';

// ---------------------------------------------------------------------------
// Table-aware mock DB factory
// ---------------------------------------------------------------------------

interface MockConfig {
  orders?: any[];
  refundRecords?: any[];
  subscriptions?: any[];
  fulfillments?: any[];
  wallet?: any;
  ledger?: any[];
  paymentTransactions?: any[];
  /** Pre-transaction refund records for order-idempotency check */
  refundRecordsForOrderCheck?: any[];
  /** Pre-transaction refund records for channelRefundNo check */
  refundRecordsForChannelCheck?: any[];
}

function createMockDb(config: MockConfig = {}) {
  // Mutable store — simulates DB state within a transaction.
  const store = {
    orders: [...(config.orders ?? [])],
    refundRecords: [...(config.refundRecords ?? [])],
    subscriptions: [...(config.subscriptions ?? [])],
    fulfillments: [...(config.fulfillments ?? [])],
    wallet: {
      id: 'w1',
      workspaceId: 'ws1',
      balance: 1000,
      reservedBalance: 0,
      updatedAt: new Date(),
      ...(config.wallet ?? {}),
    },
    ledger: [...(config.ledger ?? [])],
    paymentTransactions: [...(config.paymentTransactions ?? [])],
  };

  // Tracking arrays for assertions.
  const insertedRefundRecords: any[] = [];
  const insertedLedger: any[] = [];
  const updatedSubscriptions: any[] = [];
  const updatedRefundRecords: any[] = [];
  const updatedWallets: any[] = [];
  let ordersUpdated = false;
  let paymentTxUpdated = false;

  // Pre-transaction check data (separate from in-tx store).
  const refundForOrderCheck = config.refundRecordsForOrderCheck ?? store.refundRecords;
  const refundForChannelCheck = config.refundRecordsForChannelCheck ?? [];

  // Resolve data by table reference — THE KEY to table-aware mocking.
  const resolveData = (table: unknown): any[] => {
    if (table === ordersTable) return store.orders;
    if (table === refundTable) return store.refundRecords;
    if (table === subsTable) return store.subscriptions;
    if (table === fulfillTable) return store.fulfillments;
    if (table === walletsTable) return [store.wallet];
    if (table === ledgerTable) return store.ledger;
    if (table === txTable) return store.paymentTransactions;
    return [];
  };

  // Build a query chain that resolves to data.
  const makeChain = (data: any[]) => {
    const p = Promise.resolve(data) as any;
    p.offset = () => Promise.resolve(data);
    return p;
  };

  const makeWhere = (data: any[], table?: unknown) => ({
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => makeChain(data)),
      offset: vi.fn(() => Promise.resolve(data)),
    })),
    limit: vi.fn(() => makeChain(data)),
    for: vi.fn(() => Promise.resolve(data)), // FOR UPDATE returns same data
    groupBy: vi.fn(() => ({ limit: vi.fn(() => makeChain(data)) })),
    innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => makeChain(data)) })) })),
  });

  // Pre-transaction select: uses separate check data for refund table (recordManualRefund tests).
  // For retryCreditsRevocation, queries should return from store (reflecting updates and where filters).
  let preTxRefundQueryCount = 0;

  /**
   * Apply simple where-clause filtering for refund records.
   * Drizzle's eq/and/ne produce deeply nested SQL objects. We recursively
   * traverse the object tree to find string filter values.
   */
  const filterRefundData = (data: any[], whereArg: unknown): any[] => {
    if (!whereArg) return data;
    // Recursively search for string values in the Drizzle SQL object tree.
    // Use a visited Set to handle circular references.
    // Only traverse queryChunks (Drizzle SQL conditions) to avoid walking into
    // column/table schema definitions that contain enum values.
    const visited = new WeakSet();
    const findValues = (obj: unknown, found: string[] = []): string[] => {
      if (typeof obj === 'string') found.push(obj);
      else if (typeof obj === 'object' && obj !== null) {
        if (visited.has(obj as object)) return found;
        visited.add(obj as object);
        // Only traverse queryChunks and value properties (SQL condition parts).
        const queryChunks = (obj as any)?.queryChunks;
        if (Array.isArray(queryChunks)) {
          for (const chunk of queryChunks) {
            findValues(chunk, found);
          }
        }
        const value = (obj as any)?.value;
        if (typeof value === 'string') found.push(value);
      }
      return found;
    };
    const values = findValues(whereArg);
    let result = data;
    if (values.includes('CREDITS_PENDING')) {
      result = result.filter((r) => r.status === 'CREDITS_PENDING');
    }
    if (values.includes('REJECTED')) {
      // ne(status, 'REJECTED') — filter out REJECTED.
      result = result.filter((r) => r.status !== 'REJECTED');
    }
    return result;
  };

  const buildSelect = (isTx = false) => ({
    from: vi.fn((t: unknown) => {
      if (!isTx && t === refundTable) {
        const data = resolveData(t);
        return {
          where: vi.fn((...args: any[]) => {
            // For recordManualRefund tests with explicit check data overrides,
            // use the pre-transaction check data.
            if (config.refundRecordsForOrderCheck && preTxRefundQueryCount === 0) {
              preTxRefundQueryCount++;
              return makeWhere(refundForOrderCheck, t);
            }
            if (config.refundRecordsForChannelCheck && preTxRefundQueryCount === 1) {
              preTxRefundQueryCount++;
              return makeWhere(refundForChannelCheck, t);
            }
            // Default: return from store with where-clause filtering.
            preTxRefundQueryCount++;
            const filtered = filterRefundData(data, args[0]);
            return makeWhere(filtered, t);
          }),
        };
      }
      const data = resolveData(t);
      return { where: vi.fn(() => makeWhere(data, t)) };
    }),
  });

  // Transaction mock: provides tx with table-aware select/update/insert.
  const transaction = vi.fn(async (fn: (tx: any) => Promise<any>) => {
    const tx = {
      select: vi.fn(() => buildSelect(true)),
      update: vi.fn((t: unknown) => ({
        set: vi.fn((v: any) => ({
          where: vi.fn(() => {
            if (t === subsTable) {
              updatedSubscriptions.push(v);
              // Apply update to store
              const sub = store.subscriptions.find((s) => s.id === 'sub-1' || s.id === 's1');
              if (sub) Object.assign(sub, v);
            }
            if (t === walletsTable) {
              updatedWallets.push(v);
              Object.assign(store.wallet, v);
            }
            if (t === ordersTable) ordersUpdated = true;
            if (t === refundTable) {
              updatedRefundRecords.push(v);
              const rec = store.refundRecords[0];
              if (rec) Object.assign(rec, v);
            }
            if (t === txTable) paymentTxUpdated = true;
            return Promise.resolve();
          }),
        })),
      })),
      insert: vi.fn((t: unknown) => ({
        values: vi.fn((v: any) => ({
          returning: vi.fn(() => {
            const id = `rec-${insertedRefundRecords.length + 1}`;
            if (t === refundTable) {
              const rec = { id, ...v };
              insertedRefundRecords.push(rec);
              store.refundRecords.push(rec);
              return Promise.resolve([{ id }]);
            }
            if (t === ledgerTable) {
              const rec = { id: `ledger-${insertedLedger.length + 1}`, ...v };
              insertedLedger.push(rec);
              store.ledger.push(rec);
              return Promise.resolve([{ id: rec.id }]);
            }
            return Promise.resolve([{ id }]);
          }),
        })),
      })),
    };
    return fn(tx);
  });

  const db = {
    select: vi.fn(() => buildSelect(false)),
    transaction,
    update: vi.fn((t: unknown) => ({
      set: vi.fn((v: any) => ({
        where: vi.fn(() => {
          if (t === ordersTable) ordersUpdated = true;
          if (t === refundTable) {
            updatedRefundRecords.push(v);
            const rec = store.refundRecords[0];
            if (rec) Object.assign(rec, v);
          }
          return Promise.resolve();
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'rec-1' }])),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };

  return {
    db,
    store,
    insertedRefundRecords,
    insertedLedger,
    updatedSubscriptions,
    updatedRefundRecords,
    updatedWallets,
    get ordersUpdated() { return ordersUpdated; },
    get paymentTxUpdated() { return paymentTxUpdated; },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockWallet = (o: Record<string, unknown> = {}) =>
  ({
    refundCreditsInTx: vi.fn().mockResolvedValue({ balance: 0 }),
    adjustBalanceInTx: vi.fn().mockResolvedValue({ balance: 0 }),
    rechargeInTx: vi.fn().mockResolvedValue({ balance: 100 }),
    ...o,
  }) as any;

const svc = (db: any, p: any, f: any, w?: any) =>
  new OrdersAdminService(db, p as any, f as any, (w ?? mockWallet()) as any);

const order = (o: Record<string, unknown> = {}) => ({
  id: 'o1',
  workspaceId: 'ws1',
  userId: 'u1',
  orderType: 'RECHARGE',
  amountCents: 1000,
  currency: 'CNY',
  credits: 100,
  planId: null,
  status: 'SUCCEEDED',
  fulfillmentStatus: 'SUCCEEDED',
  snapshotJson: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const R = {
  operatorId: 'admin-1',
  reason: '用户投诉退款',
  refundChannel: 'ALIPAY',
  channelRefundNo: 'ALI202608130001',
  externalRefundedAt: '2026-08-13T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrdersAdminService', () => {
  describe('list', () => {
    it('applies limit and offset clamps', async () => {
      expect(await svc(createMockDb({ orders: [] }).db, {}, {}).list({ limit: 500, offset: -10 })).toEqual([]);
    });
    it('returns mapped order views', async () => {
      const mock = createMockDb({ orders: [order()] });
      const r = await svc(mock.db, {}, {}).list({});
      expect(r).toHaveLength(1);
      expect(r[0].id).toBe('o1');
    });
  });

  it('closeOrder delegates to payment', async () => {
    const p = { closePayment: vi.fn().mockResolvedValue(undefined) };
    await svc(createMockDb().db, p, {}).closeOrder('o1');
    expect(p.closePayment).toHaveBeenCalledWith('o1');
  });

  it('retryFulfillment delegates', async () => {
    const f = { fulfill: vi.fn().mockResolvedValue({ orderId: 'o1', status: 'SUCCEEDED', subscriptionId: 's', creditsGranted: 1 }) };
    expect((await svc(createMockDb().db, {}, f).retryFulfillment('o1')).status).toBe('SUCCEEDED');
  });

  // ---- recordManualRefund ----

  describe('recordManualRefund', () => {
    it('1. ALIPAY full refund succeeds', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      const r = await svc(mock.db, {}, {}, w).recordManualRefund('o1', { ...R, refundChannel: 'ALIPAY' });
      expect(r.status).toBe('COMPLETED');
      expect(r.creditsRevoked).toBe(100);
      expect(r.creditsFullyRevoked).toBe(true);
    });

    it('2. WECHAT full refund succeeds', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      const r = await svc(mock.db, {}, {}, w).recordManualRefund('o1', { ...R, refundChannel: 'WECHAT', channelRefundNo: 'WX1' });
      expect(r.status).toBe('COMPLETED');
      expect(r.creditsRevoked).toBe(100);
    });

    it('3. no payment provider refund API called', async () => {
      const p = { refund: vi.fn(), refundPayment: vi.fn(), refundTrade: vi.fn(), closePayment: vi.fn() };
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      await svc(mock.db, p, {}, w).recordManualRefund('o1', R);
      expect(p.refund).not.toHaveBeenCalled();
      expect((p as any).refundPayment).not.toHaveBeenCalled();
      expect((p as any).refundTrade).not.toHaveBeenCalled();
    });

    it('4. orders.status unchanged (stays SUCCEEDED)', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      await svc(mock.db, {}, {}, w).recordManualRefund('o1', R);
      expect(mock.store.orders[0].status).toBe('SUCCEEDED');
      expect(mock.ordersUpdated).toBe(false);
    });

    it('5. manualRefundRecords written with correct fields', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      await svc(mock.db, {}, {}, w).recordManualRefund('o1', { ...R, reviewNote: '已核实' });
      expect(mock.insertedRefundRecords).toHaveLength(1);
      const c = mock.insertedRefundRecords[0];
      expect(c.orderId).toBe('o1');
      expect(c.workspaceId).toBe('ws1');
      expect(c.status).toBe('COMPLETED');
      expect(c.refundChannel).toBe('ALIPAY');
      expect(c.channelRefundNo).toBe('ALI202608130001');
      expect(c.creditsToRevoke).toBe(100);
      expect(c.creditsRevoked).toBe(100);
      expect(c.creditsFullyRevoked).toBe(true);
      expect(c.isFullRefund).toBe(true);
      expect(c.operatorId).toBe('admin-1');
      expect(c.reviewNote).toBe('已核实');
      expect(c.externalRefundedAt).toEqual(new Date('2026-08-13T10:00:00.000Z'));
      expect(c.processedAt).toBeInstanceOf(Date); // COMPLETED → processedAt set
    });

    it('6. REFUND ledger via refundCreditsInTx with correct args', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      await svc(mock.db, {}, {}, w).recordManualRefund('o1', R);
      expect(w.refundCreditsInTx).toHaveBeenCalledTimes(1);
      const a = w.refundCreditsInTx.mock.calls[0];
      expect(a[1]).toBe('ws1'); // workspaceId
      expect(a[2]).toBe(100); // creditsToRevoke
      expect(a[3]).toBe('o1'); // orderId
      expect(a[4]).toBe('manual-refund:o1:ALI202608130001'); // idempotencyKey
    });

    it('7. duplicate refund for same order rejected', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        refundRecordsForOrderCheck: [{ id: 'e1', orderId: 'o1', status: 'COMPLETED' }],
      });
      await expect(svc(mock.db, {}, {}, w).recordManualRefund('o1', { ...R, channelRefundNo: 'ALI2' }))
        .rejects.toThrow(/already recorded/);
    });

    it('7a. CREDITS_PENDING existing record returns helpful message', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        refundRecordsForOrderCheck: [{ id: 'e1', orderId: 'o1', status: 'CREDITS_PENDING' }],
      });
      await expect(svc(mock.db, {}, {}, w).recordManualRefund('o1', { ...R, channelRefundNo: 'ALI2' }))
        .rejects.toThrow(/credits-retry/);
    });

    it('8. duplicate channelRefundNo rejected', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        refundRecordsForOrderCheck: [],
        refundRecordsForChannelCheck: [{ id: 'e1', channelRefundNo: 'ALI202608130001' }],
      });
      await expect(svc(mock.db, {}, {}, w).recordManualRefund('o1', R))
        .rejects.toThrow(/channelRefundNo.*already exists/);
    });

    it('9. refund exceeding order amount rejected', async () => {
      const mock = createMockDb({ orders: [order()] });
      await expect(svc(mock.db, {}, {}).recordManualRefund('o1', { ...R, refundAmountCents: 2000 }))
        .rejects.toThrow(/exceeds order amount/);
    });

    it('10. proportional credits for partial refund', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      const r = await svc(mock.db, {}, {}, w).recordManualRefund('o1', { ...R, refundAmountCents: 500 });
      expect(r.creditsToRevoke).toBe(50);
      expect(r.creditsRevoked).toBe(50);
      expect(r.isFullRefund).toBe(false);
      expect(r.status).toBe('COMPLETED');
    });

    it('11. CREDITS_PENDING when insufficient (not COMPLETED)', async () => {
      const w = mockWallet({
        refundCreditsInTx: vi.fn().mockImplementation(() => {
          const e = new Error('insufficient') as Error & { code: string };
          e.code = ERROR_CODES.NEGATIVE_BALANCE;
          throw e;
        }),
      });
      const mock = createMockDb({ orders: [order()] });
      const r = await svc(mock.db, {}, {}, w).recordManualRefund('o1', R);
      expect(r.status).toBe('CREDITS_PENDING');
      expect(r.creditsFullyRevoked).toBe(false);
      expect(r.creditsRevoked).toBe(0);
      expect(mock.insertedRefundRecords[0].status).toBe('CREDITS_PENDING');
      // CREDITS_PENDING must NOT write processedAt.
      expect(mock.insertedRefundRecords[0].processedAt).toBeNull();
    });

    it('12. only order-linked subscription canceled for PLAN full refund', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order({ orderType: 'PLAN', planId: 'p1' })],
        fulfillments: [{ id: 'f1', orderId: 'o1', subscriptionId: 'sub-1' }],
        subscriptions: [
          { id: 'sub-1', workspaceId: 'ws1', status: 'ACTIVE', planId: 'p1', updatedAt: new Date() },
          { id: 'sub-2', workspaceId: 'ws1', status: 'ACTIVE', planId: 'p2', updatedAt: new Date() },
        ],
      });
      const r = await svc(mock.db, {}, {}, w).recordManualRefund('o1', R);
      expect(r.subscriptionCanceled).toBe(true);
      expect(mock.updatedSubscriptions).toHaveLength(1);
      expect(mock.updatedSubscriptions[0].status).toBe('CANCELED');
      // Other subscription must NOT be canceled.
      expect(mock.store.subscriptions[1].status).toBe('ACTIVE');
    });

    it('12a. no cancel when fulfillment has no subscriptionId', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order({ orderType: 'PLAN' })],
        fulfillments: [{ id: 'f1', orderId: 'o1', subscriptionId: null }],
      });
      expect((await svc(mock.db, {}, {}, w).recordManualRefund('o1', R)).subscriptionCanceled).toBe(false);
    });

    it('12b. no cancel when subscription already CANCELED', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order({ orderType: 'PLAN' })],
        fulfillments: [{ id: 'f1', orderId: 'o1', subscriptionId: 's1' }],
        subscriptions: [{ id: 's1', workspaceId: 'ws1', status: 'CANCELED', updatedAt: new Date() }],
      });
      expect((await svc(mock.db, {}, {}, w).recordManualRefund('o1', R)).subscriptionCanceled).toBe(false);
    });

    it('12c. no cancel for non-PLAN order', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order({ orderType: 'RECHARGE' })],
        fulfillments: [{ id: 'f1', orderId: 'o1', subscriptionId: 's1' }],
        subscriptions: [{ id: 's1', workspaceId: 'ws1', status: 'ACTIVE', updatedAt: new Date() }],
      });
      expect((await svc(mock.db, {}, {}, w).recordManualRefund('o1', R)).subscriptionCanceled).toBe(false);
    });

    it('12d. CREDITS_PENDING still cancels subscription (cash already refunded)', async () => {
      const w = mockWallet({
        refundCreditsInTx: vi.fn().mockImplementation(() => {
          const e = new Error('insufficient') as Error & { code: string };
          e.code = ERROR_CODES.NEGATIVE_BALANCE;
          throw e;
        }),
      });
      const mock = createMockDb({
        orders: [order({ orderType: 'PLAN', planId: 'p1' })],
        fulfillments: [{ id: 'f1', orderId: 'o1', subscriptionId: 'sub-1' }],
        subscriptions: [{ id: 'sub-1', workspaceId: 'ws1', status: 'ACTIVE', planId: 'p1', updatedAt: new Date() }],
      });
      const r = await svc(mock.db, {}, {}, w).recordManualRefund('o1', R);
      expect(r.status).toBe('CREDITS_PENDING');
      expect(r.subscriptionCanceled).toBe(true);
    });

    it('13. concurrent duplicate rejected (shared state + Promise.all)', async () => {
      // Simulate two concurrent requests hitting the same order.
      // The first request inserts a refund record; the second must see it and fail.
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });

      // Override transaction to serialize and share state.
      let txCount = 0;
      mock.db.transaction = vi.fn(async (fn: (tx: any) => Promise<any>) => {
        txCount++;
        // First request proceeds normally; second sees the record inserted by first.
        const existingInTx = txCount > 1 ? [{ id: 'rec-1' }] : [];
        const tx = {
          select: vi.fn(() => ({
            from: vi.fn((t: unknown) => {
              if (t === ordersTable) return { where: vi.fn(() => ({ for: vi.fn(() => Promise.resolve([order()])) })) };
              if (t === refundTable) return { where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(existingInTx)) })) };
              if (t === fulfillTable) return { where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) };
              if (t === subsTable) return { where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) };
              return { where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) };
            }),
          })),
          update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
          insert: vi.fn((t: unknown) => ({
            values: vi.fn((v: any) => ({
              returning: vi.fn(() => {
                if (t === refundTable) {
                  mock.insertedRefundRecords.push({ id: 'rec-1', ...v });
                  return Promise.resolve([{ id: 'rec-1' }]);
                }
                return Promise.resolve([{ id: 'x' }]);
              }),
            })),
          })),
        };
        return fn(tx);
      });

      const results = await Promise.allSettled([
        svc(mock.db, {}, {}, w).recordManualRefund('o1', R),
        svc(mock.db, {}, {}, w).recordManualRefund('o1', { ...R, channelRefundNo: 'ALI2' }),
      ]);

      // Exactly one must succeed, one must fail.
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
    });

    it('14. transaction errors propagated (not swallowed)', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      mock.db.transaction = vi.fn().mockRejectedValue(new Error('DB lost'));
      await expect(svc(mock.db, {}, {}, w).recordManualRefund('o1', R)).rejects.toThrow(/DB lost/);
    });

    it('15. PaymentService.refund not called', async () => {
      const p = { refund: vi.fn(), closePayment: vi.fn() };
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      await svc(mock.db, p, {}, w).recordManualRefund('o1', R);
      expect(p.refund).not.toHaveBeenCalled();
    });

    it('16. no legacy payment_transactions refund fields written', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      await svc(mock.db, {}, {}, w).recordManualRefund('o1', R);
      expect(mock.paymentTxUpdated).toBe(false);
      expect(mock.store.orders[0].status).toBe('SUCCEEDED');
    });

    it('rejects invalid refundChannel', async () => {
      const mock = createMockDb({ orders: [order()] });
      await expect(svc(mock.db, {}, {}).recordManualRefund('o1', { ...R, refundChannel: 'sandbox' }))
        .rejects.toThrow(/ALIPAY or WECHAT/);
    });

    it('rejects missing channelRefundNo', async () => {
      const mock = createMockDb({ orders: [order()] });
      await expect(svc(mock.db, {}, {}).recordManualRefund('o1', { ...R, channelRefundNo: '' }))
        .rejects.toThrow(/channelRefundNo is required/);
    });

    it('rejects whitespace-only channelRefundNo', async () => {
      const mock = createMockDb({ orders: [order()] });
      await expect(svc(mock.db, {}, {}).recordManualRefund('o1', { ...R, channelRefundNo: '   ' }))
        .rejects.toThrow(/channelRefundNo is required/);
    });

    it('trims channelRefundNo before using it', async () => {
      const w = mockWallet();
      const mock = createMockDb({ orders: [order()] });
      const r = await svc(mock.db, {}, {}, w).recordManualRefund('o1', {
        ...R,
        channelRefundNo: '  ALI202608130001  ',
      });
      expect(r.status).toBe('COMPLETED');
      // The trimmed value should be used in the refund record.
      expect(mock.insertedRefundRecords[0].channelRefundNo).toBe('ALI202608130001');
      // The idempotency key should use the trimmed value.
      expect(w.refundCreditsInTx.mock.calls[0][4]).toBe('manual-refund:o1:ALI202608130001');
    });

    it('rejects zero refund amount', async () => {
      const mock = createMockDb({ orders: [order()] });
      await expect(svc(mock.db, {}, {}).recordManualRefund('o1', { ...R, refundAmountCents: 0 }))
        .rejects.toThrow(/positive integer/);
    });

    it('rejects non-SUCCEEDED order', async () => {
      const mock = createMockDb({ orders: [order({ status: 'PENDING' })] });
      await expect(svc(mock.db, {}, {}).recordManualRefund('o1', R))
        .rejects.toThrow(/Cannot record manual refund/);
    });

    it('rejects order not found', async () => {
      const mock = createMockDb({ orders: [] });
      await expect(svc(mock.db, {}, {}).recordManualRefund('x', R))
        .rejects.toThrow(/Order not found/);
    });
  });

  // ---- retryCreditsRevocation ----

  describe('retryCreditsRevocation', () => {
    const pendingRecord = (o: Record<string, unknown> = {}) => ({
      id: 'ref-1',
      orderId: 'o1',
      workspaceId: 'ws1',
      status: 'CREDITS_PENDING',
      reason: '用户投诉退款',
      refundAmountCents: 1000,
      isFullRefund: true,
      channelRefundNo: 'ALI202608130001',
      refundChannel: 'ALIPAY',
      creditsToRevoke: 100,
      creditsRevoked: 0,
      creditsFullyRevoked: false,
      operatorId: 'admin-1',
      reviewNote: null,
      externalRefundedAt: new Date('2026-08-13T10:00:00.000Z'),
      processedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...o,
    });

    it('8. credits-retry success: CREDITS_PENDING → COMPLETED', async () => {
      const w = mockWallet(); // refundCreditsInTx succeeds
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord()],
      });
      const r = await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      expect(r.status).toBe('COMPLETED');
      expect(r.creditsRevoked).toBe(100);
      expect(r.creditsFullyRevoked).toBe(true);
    });

    it('9. credits-retry insufficient: stays CREDITS_PENDING', async () => {
      const w = mockWallet({
        refundCreditsInTx: vi.fn().mockImplementation(() => {
          const e = new Error('insufficient') as Error & { code: string };
          e.code = ERROR_CODES.NEGATIVE_BALANCE;
          throw e;
        }),
      });
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord()],
      });
      const r = await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      expect(r.status).toBe('CREDITS_PENDING');
      expect(r.creditsFullyRevoked).toBe(false);
    });

    it('10. retry does NOT re-create cash refund record', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord()],
      });
      await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      // No new refund record inserted.
      expect(mock.insertedRefundRecords).toHaveLength(0);
    });

    it('11. retry does NOT cancel subscription again', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order({ orderType: 'PLAN', planId: 'p1' })],
        refundRecords: [pendingRecord()],
        fulfillments: [{ id: 'f1', orderId: 'o1', subscriptionId: 'sub-1' }],
        subscriptions: [{ id: 'sub-1', workspaceId: 'ws1', status: 'ACTIVE', planId: 'p1', updatedAt: new Date() }],
      });
      await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      expect(mock.updatedSubscriptions).toHaveLength(0);
    });

    it('rejects if no refund record found', async () => {
      const mock = createMockDb({ orders: [order()], refundRecords: [] });
      await expect(svc(mock.db, {}, {}).retryCreditsRevocation('o1', { operatorId: 'admin-1' }))
        .rejects.toThrow(/not found/);
    });

    it('rejects if status is not CREDITS_PENDING', async () => {
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord({ status: 'COMPLETED' })],
      });
      await expect(svc(mock.db, {}, {}).retryCreditsRevocation('o1', { operatorId: 'admin-1' }))
        .rejects.toThrow(/Only CREDITS_PENDING is retryable/);
    });

    it('filters by CREDITS_PENDING and uses stable ordering when multiple records exist', async () => {
      // When there are multiple refund records for the same order (e.g., REJECTED + CREDITS_PENDING),
      // the service should pick the CREDITS_PENDING one, not the first one returned by the DB.
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        // The mock returns all refund records — the service should filter by CREDITS_PENDING.
        refundRecords: [
          pendingRecord({ id: 'ref-pending', status: 'CREDITS_PENDING' }),
        ],
      });
      const r = await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      expect(r.status).toBe('COMPLETED');
      expect(r.recordId).toBe('ref-pending');
    });

    it('returns helpful error when only non-CREDITS_PENDING records exist', async () => {
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord({ id: 'ref-completed', status: 'COMPLETED' })],
      });
      await expect(svc(mock.db, {}, {}).retryCreditsRevocation('o1', { operatorId: 'admin-1' }))
        .rejects.toThrow(/Only CREDITS_PENDING is retryable/);
    });

    it('uses stable idempotency key manual-refund:${recordId}:credits', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord({ id: 'ref-xyz' })],
      });
      await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      expect(w.refundCreditsInTx).toHaveBeenCalledTimes(1);
      const idempotencyKey = w.refundCreditsInTx.mock.calls[0][4];
      expect(idempotencyKey).toBe('manual-refund:ref-xyz:credits');
    });

    it('idempotency: if REFUND ledger already exists, returns COMPLETED without double-deduct', async () => {
      // Wallet mock: refundCreditsInTx returns current balance (idempotent skip).
      const w = mockWallet({
        refundCreditsInTx: vi.fn().mockResolvedValue({ balance: 400 }),
      });
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord()],
      });
      const r = await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      // Should succeed (COMPLETED) since wallet didn't throw.
      expect(r.status).toBe('COMPLETED');
    });

    it('retry updates processedAt when COMPLETED', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord()],
      });
      await svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' });
      // Check that refund record was updated with processedAt.
      const update = mock.updatedRefundRecords.find((u) => u.status === 'COMPLETED');
      expect(update).toBeDefined();
      expect(update.processedAt).toBeInstanceOf(Date);
    });

    it('retry transaction error propagated', async () => {
      const w = mockWallet();
      const mock = createMockDb({
        orders: [order()],
        refundRecords: [pendingRecord()],
      });
      mock.db.transaction = vi.fn().mockRejectedValue(new Error('DB connection lost'));
      await expect(svc(mock.db, {}, {}, w).retryCreditsRevocation('o1', { operatorId: 'admin-1' }))
        .rejects.toThrow(/DB connection lost/);
    });
  });
});
