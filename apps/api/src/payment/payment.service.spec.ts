import { describe, expect, it, vi } from 'vitest';
import { PaymentService } from './payment.service.js';

function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

const env: Record<string, unknown> = {
  PAYMENT_MODE: 'sandbox',
  PAYMENT_CREDITS_PER_CNY: 100,
  PAYMENT_MIN_RECHARGE_CENTS: 100,
  PAYMENT_RETURN_BASE_URL: 'http://localhost:3001',
  PAYMENT_NOTIFY_URL: 'http://localhost:3001/api/v1/payment/notify',
  ALIPAY_APP_ID: '',
  ALIPAY_PRIVATE_KEY: '',
  ALIPAY_PUBLIC_KEY: '',
  ALIPAY_GATEWAY: '',
  WECHAT_APP_ID: '',
  WECHAT_MCH_ID: '',
  WECHAT_API_V3_KEY: '',
  WECHAT_SERIAL_NO: '',
  WECHAT_PRIVATE_KEY: '',
};

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
    insert: (t: unknown) => ({
      values: () => Promise.resolve([]),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _t: tableKey(t),
    }),
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
    insert: (t: unknown) => ({
      values: () => Promise.resolve([]),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _t: tableKey(t),
    }),
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

const user = { userId: 'u1', workspaceId: 'ws1', email: 'a@b.c', role: 'USER', status: 'ACTIVE' } as any;

describe('PaymentService', () => {
  describe('createRecharge', () => {
    it('rejects amounts below the minimum', async () => {
      const db = createDb({});
      const svc = new PaymentService(env as any, db as any, makeWallet() as any);
      await expect(svc.createRecharge(user, 50)).rejects.toThrowError(/below minimum/i);
    });

    it('creates a PENDING order, calls provider, and records a transaction', async () => {
      const db = createDb({});
      const svc = new PaymentService(env as any, db as any, makeWallet() as any);
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
      const orderRow = { id: 'o1', workspaceId: 'ws1', userId: 'u1', amountCents: 1000, credits: 1000, status: 'PENDING' };
      const db = createDb({
        // requireOrderForWorkspace + 入账事务行锁 + 最终余额查询都用 'sel:orders'/'sel:wallets'
        'sel:orders': () => [orderRow],
        'sel:wallets': () => [{ balance: 200 }],
      });
      const wallet = makeWallet();
      const svc = new PaymentService(env as any, db as any, wallet as any);
      const res = await svc.simulateConfirm(user, 'o1');
      expect(res.credits).toBe(1000);
      expect(res.balance).toBe(200);
      expect(wallet.rechargeInTx).toHaveBeenCalledWith(expect.anything(), 'ws1', 1000, 'o1', 'payment:recharge:o1');
    });

    it('rejects orders from another workspace (IDOR)', async () => {
      const db = createDb({ 'sel:orders': () => [{ id: 'o1', workspaceId: 'ws-other' }] });
      const svc = new PaymentService(env as any, db as any, makeWallet() as any);
      const other = { userId: 'u1', workspaceId: 'ws1' } as any;
      await expect(svc.simulateConfirm(other, 'o1')).rejects.toThrowError(/does not belong/i);
    });
  });

  describe('notify', () => {
    it('throws on invalid sandbox notification body', async () => {
      const db = createDb({});
      const svc = new PaymentService(env as any, db as any, makeWallet() as any);
      await expect(svc.notify('sandbox', JSON.stringify({ hello: 1 }), {})).rejects.toThrow(/missing orderId\/tradeNo/);
    });

    it('settles a success notification and recharges', async () => {
      const orderRow = { id: 'o1', workspaceId: 'ws1', userId: 'u1', amountCents: 1000, credits: 1000, status: 'PENDING' };
      const db = createDb({ 'sel:orders': () => [orderRow] });
      const wallet = makeWallet();
      const svc = new PaymentService(env as any, db as any, wallet as any);
      const res = await svc.notify(
        'sandbox',
        JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 1000, status: 'success' }),
        {},
      );
      expect(res.received).toBe(true);
      expect(wallet.rechargeInTx).toHaveBeenCalled();
    });

    it('rejects amount mismatch', async () => {
      const orderRow = { id: 'o1', workspaceId: 'ws1', userId: 'u1', amountCents: 1000, credits: 1000, status: 'PENDING' };
      const db = createDb({ 'sel:orders': () => [orderRow] });
      const svc = new PaymentService(env as any, db as any, makeWallet() as any);
      await expect(
        svc.notify('sandbox', JSON.stringify({ orderId: 'o1', tradeNo: 'T1', amountCents: 999, status: 'success' }), {}),
      ).rejects.toThrowError(/amount mismatch/i);
    });
  });
});