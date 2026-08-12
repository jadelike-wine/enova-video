import { describe, expect, it, vi } from 'vitest';
import { PaymentService } from './payment.service.js';

function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

function createDb(handlers: Record<string, () => any>) {
  const calls: Record<string, number> = {};
  const next = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1;
    return handlers[key] ? handlers[key](calls[key]) : [];
  };
  const tx = {
    select: () => ({
      from: (t: unknown) => {
        const key = 'sel:' + tableKey(t);
        const chain: any = {
          where: () => chain,
          limit: () => Promise.resolve(next(key)),
          for: () => Promise.resolve(next(key)),
        };
        return chain;
      },
    }),
    update: (t: unknown) => ({
      set: () => ({ where: () => Promise.resolve([]) }),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _t: tableKey(t),
    }),
    insert: (t: unknown) => {
      const insertChain: any = {
        values: () => insertChain,
        onConflictDoNothing: () => insertChain,
        returning: () => Promise.resolve([]),
      };
      insertChain._t = tableKey(t);
      return insertChain;
    },
  };
  return {
    select: () => ({
      from: (t: unknown) => {
        const key = 'sel:' + tableKey(t);
        const chain: any = {
          where: () => chain,
          limit: () => Promise.resolve(next(key)),
          for: () => Promise.resolve(next(key)),
        };
        return chain;
      },
    }),
    insert: (t: unknown) => {
      const insertChain: any = {
        values: () => insertChain,
        onConflictDoNothing: () => insertChain,
        returning: () => Promise.resolve([]),
      };
      insertChain._t = tableKey(t);
      return insertChain;
    },
    update: (t: unknown) => ({
      set: () => ({ where: () => Promise.resolve([]) }),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _t: tableKey(t),
    }),
    transaction: (cb: (t: any) => unknown) => cb(tx),
  };
}

function makeWallet() {
  return {
    rechargeInTx: vi.fn(async () => ({ balance: 200 })),
    recharge: vi.fn(async () => ({ balance: 200 })),
  };
}

function makeFulfillment() {
  return {
    fulfill: vi.fn(async (orderId: string) => ({
      orderId,
      status: 'SUCCEEDED' as const,
      subscriptionId: 'sub-1',
      creditsGranted: 0,
    })),
    reconcilePendingFulfillments: vi.fn(async () => ({ fulfilled: 0, failed: 0 })),
    getFulfillment: vi.fn(async () => null),
  };
}

function makeSettings() {
  return {
    getNumber: vi.fn(async (key: string) => {
      if (key === 'payment.minRechargeCents') return 100;
      if (key === 'payment.creditsPerCny') return 100;
      return null;
    }),
    getString: vi.fn(async (key: string) => {
      if (key === 'payment.mode') return 'sandbox';
      if (key === 'payment.returnBaseUrl') return 'http://localhost:3001';
      if (key === 'payment.notifyUrl') return 'http://localhost:3001/api/v1/payment/notify';
      return null;
    }),
  };
}

const user = { userId: 'u1', workspaceId: 'ws1', email: 'a@b.c', role: 'USER', status: 'ACTIVE' } as any;

describe('PaymentService', () => {
  describe('createRecharge', () => {
    it('rejects amounts below the minimum', async () => {
      const db = createDb({});
      const svc = new PaymentService(db as any, makeSettings() as any, makeWallet() as any, makeFulfillment() as any);
      await expect(svc.createRecharge(user, 50)).rejects.toThrowError(/below minimum/i);
    });

    it('creates a PENDING order, calls provider, and records a transaction', async () => {
      const db = createDb({});
      const svc = new PaymentService(db as any, makeSettings() as any, makeWallet() as any, makeFulfillment() as any);
      const res = await svc.createRecharge(user, 1000);
      expect(res.amountCents).toBe(1000);
      expect(res.credits).toBe(1000); // 10 元 = 1000 credits
      expect(res.channel).toBe('sandbox');
      expect(res.tradeNo).toMatch(/^SANDBOX-/);
      expect(res.payUrl).toBeTruthy();
      expect(res.orderId).toBeTruthy();
    });
  });

  describe('simulateConfirm', () => {
    it('settles an order owned by the workspace and returns new balance', async () => {
      const orderRow = { id: 'o1', workspaceId: 'ws1', userId: 'u1', amountCents: 1000, credits: 1000, status: 'PENDING', orderType: 'RECHARGE', currency: 'CNY', fulfillmentStatus: 'PENDING' };
      const db = createDb({
        // requireOrderForWorkspace + 入账事务行锁 + 最终余额查询都用 'sel:orders'/'sel:wallets'
        'sel:orders': () => [orderRow],
        'sel:wallets': () => [{ balance: 200 }],
      });
      const wallet = makeWallet();
      const svc = new PaymentService(db as any, makeSettings() as any, wallet as any, makeFulfillment() as any);
      const res = await svc.simulateConfirm(user, 'o1');
      expect(res.credits).toBe(1000);
      expect(res.balance).toBe(200);
      expect(wallet.rechargeInTx).toHaveBeenCalledWith(expect.anything(), 'ws1', 1000, 'o1', 'payment:recharge:o1');
    });

    it('rejects orders from another workspace (IDOR)', async () => {
      const db = createDb({ 'sel:orders': () => [{ id: 'o1', workspaceId: 'ws-other' }] });
      const svc = new PaymentService(db as any, makeSettings() as any, makeWallet() as any, makeFulfillment() as any);
      const other = { userId: 'u1', workspaceId: 'ws1' } as any;
      await expect(svc.simulateConfirm(other, 'o1')).rejects.toThrowError(/does not belong/i);
    });
  });

  describe('notify', () => {
    it('throws on invalid sandbox notification body', async () => {
      const db = createDb({});
      const svc = new PaymentService(db as any, makeSettings() as any, makeWallet() as any, makeFulfillment() as any);
      await expect(svc.notify('sandbox', JSON.stringify({ hello: 1 }), {})).rejects.toThrow(/missing orderId\/tradeNo/);
    });

    it('settles a success notification and recharges', async () => {
      const orderRow = { id: 'o1', workspaceId: 'ws1', userId: 'u1', amountCents: 1000, credits: 1000, status: 'PENDING', orderType: 'RECHARGE', currency: 'CNY', fulfillmentStatus: 'PENDING' };
      const db = createDb({ 'sel:orders': () => [orderRow] });
      const wallet = makeWallet();
      const svc = new PaymentService(db as any, makeSettings() as any, wallet as any, makeFulfillment() as any);
      const res = await svc.notify(
        'sandbox',
        JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' }),
        {},
      );
      expect(res.received).toBe(true);
      expect(wallet.rechargeInTx).toHaveBeenCalled();
    });

    it('rejects amount mismatch', async () => {
      const orderRow = { id: 'o1', workspaceId: 'ws1', userId: 'u1', amountCents: 1000, credits: 1000, status: 'PENDING', orderType: 'RECHARGE', currency: 'CNY', fulfillmentStatus: 'PENDING' };
      const db = createDb({ 'sel:orders': () => [orderRow] });
      const svc = new PaymentService(db as any, makeSettings() as any, makeWallet() as any, makeFulfillment() as any);
      await expect(
        svc.notify('sandbox', JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 999, status: 'success' }), {}),
      ).rejects.toThrowError(/amount mismatch/i);
    });
  });
});