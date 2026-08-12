import { describe, expect, it, vi } from 'vitest';
import { SubscriptionFulfillmentService } from './subscription-fulfillment.service.js';

/**
 * P0-3 回归测试：
 *  - duplicate fulfillment：同一订单 fulfill() 3 次，只能产生 1 次 subscription + 1 次 credits 发放 + 1 条 fulfillment。
 *  - plan changed after purchase：成交后管理员改 plan（credits/period），历史订单仍按快照履约，不被当前 plan 覆盖。
 */
interface Order {
  id: string;
  workspaceId: string;
  planId: string | null;
  status: string;
  fulfillmentStatus: string;
  snapshotJson: Record<string, unknown> | null;
  orderType: string;
  credits: number;
}

function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

function createHarness(order: Order, plan: { id: string; name: string; monthlyCredits: number; periodDays: number }) {
  const insertedSubscriptions: Array<{ planId: string; status: string }> = [];
  const insertedFulfillments: Array<{ orderId: string; status: string; creditsGranted: number }> = [];
  const updatedOrders: string[] = [];
  const rechargeCalls: Array<{ amount: number; idempotencyKey: string }> = [];

  const wallet = {
    rechargeInTx: vi.fn(async (_tx: unknown, _wsId: string, amount: number, _key: string, idem: string) => {
      rechargeCalls.push({ amount, idempotencyKey: idem });
    }),
  };

  // 事务执行器：把 mock tx 传给回调。
  const runTx = async (fn: (tx: any) => Promise<unknown>) => fn(tx);

  const tx = {
    select: () => ({
      from: (t: unknown) => {
        const key = tableKey(t);
        const chain: any = {};
        chain.where = () => {
          if (key === 'orders') {
            // for('update') 行锁
            chain.for = () => Promise.resolve([order]);
            return chain;
          }
          if (key === 'plans') {
            chain.limit = () => Promise.resolve([plan]);
            return chain;
          }
          return chain;
        };
        chain.limit = () => Promise.resolve([]);
        return chain;
      },
    }),
    insert: (t: unknown) => ({
      values: (v: any) => {
        const key = tableKey(t);
        if (key === 'subscriptions') {
          insertedSubscriptions.push({ planId: v.planId, status: v.status });
          return { returning: () => Promise.resolve([{ id: `sub-${insertedSubscriptions.length}` }]) };
        }
        if (key === 'subscription_fulfillments') {
          insertedFulfillments.push({ orderId: v.orderId, status: v.status, creditsGranted: v.creditsGranted });
        }
        return { returning: () => Promise.resolve([]) };
      },
      returning: () => Promise.resolve([]),
    }),
    update: (t: unknown) => ({
      set: () => ({
        where: () => {
          updatedOrders.push(tableKey(t));
          return Promise.resolve([]);
        },
      }),
    }),
  };

  // db 层：幂等预检查读取已插入的 fulfillment。
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const key = tableKey(t);
        const chain: any = {
          where: () => {
            chain.limit = () => Promise.resolve(insertedFulfillments.slice(-1));
            return chain;
          },
        };
        return chain;
      },
    }),
    transaction: (fn: (tx: any) => Promise<unknown>) => runTx(fn),
  };

  const svc = new SubscriptionFulfillmentService(db as any, wallet as any);
  return { svc, wallet, insertedSubscriptions, insertedFulfillments, updatedOrders, rechargeCalls };
}

describe('SubscriptionFulfillmentService (P0-3)', () => {
  it('duplicate fulfillment: fulfill() x3 只产生一次 subscription + 一次 credits 发放 + 一条 fulfillment', async () => {
    const baseOrder: Order = {
      id: 'ord-1',
      workspaceId: 'ws-1',
      planId: 'plan-1',
      status: 'SUCCEEDED',
      fulfillmentStatus: 'PENDING',
      orderType: 'PLAN',
      credits: 100,
      snapshotJson: {
        orderType: 'PLAN',
        planId: 'plan-1',
        planCode: 'PRO',
        planName: 'Pro',
        monthlyCredits: 100,
        periodDays: 30,
        priceCents: 9900,
        currency: 'CNY',
      },
    };
    const h = createHarness(baseOrder, { id: 'plan-1', name: 'Pro', monthlyCredits: 100, periodDays: 30 });

    const r1 = await h.svc.fulfill('ord-1');
    const r2 = await h.svc.fulfill('ord-1');
    const r3 = await h.svc.fulfill('ord-1');

    // 只有第一次真正履约。
    expect(r1.status).toBe('SUCCEEDED');
    expect(r2.status).toBe('ALREADY_FULFILLED');
    expect(r3.status).toBe('ALREADY_FULFILLED');

    // 只产生 1 条 subscription、1 条 fulfillment、1 次 credits 发放。
    expect(h.insertedSubscriptions.length).toBe(1);
    expect(h.insertedFulfillments.length).toBe(1);
    expect(h.rechargeCalls.length).toBe(1);
    expect(h.rechargeCalls[0].amount).toBe(100);
    expect(h.rechargeCalls[0].idempotencyKey).toBe(`subscription:grant:ord-1`);
    expect(h.updatedOrders.length).toBe(1);
  });

  it('plan changed after purchase: 履约按快照（历史 credits），不被当前 plan 覆盖', async () => {
    // 用户下单时 plan: monthlyCredits=100, periodDays=30（已冻结进快照）。
    const baseOrder: Order = {
      id: 'ord-2',
      workspaceId: 'ws-2',
      planId: 'plan-2',
      status: 'SUCCEEDED',
      fulfillmentStatus: 'PENDING',
      orderType: 'PLAN',
      credits: 100,
      snapshotJson: {
        orderType: 'PLAN',
        planId: 'plan-2',
        planCode: 'PRO',
        planName: 'Pro',
        monthlyCredits: 100,
        periodDays: 30,
        priceCents: 9900,
        currency: 'CNY',
      },
    };
    // 成交后管理员把 plan 改成 monthlyCredits=9999, periodDays=1。
    const h = createHarness(baseOrder, { id: 'plan-2', name: 'Pro (changed)', monthlyCredits: 9999, periodDays: 1 });

    const r = await h.svc.fulfill('ord-2');

    // 仍按快照发放 100（而非当前 plan 的 9999）。
    expect(r.status).toBe('SUCCEEDED');
    expect(r.creditsGranted).toBe(100);
    expect(h.rechargeCalls.length).toBe(1);
    expect(h.rechargeCalls[0].amount).toBe(100);
    // subscription 仍指向 plan-2（历史 planId）。
    expect(h.insertedSubscriptions[0].planId).toBe('plan-2');
    expect(h.insertedFulfillments[0].creditsGranted).toBe(100);
  });

  it('snapshot missing fields: 回退到当前 plan', async () => {
    const baseOrder: Order = {
      id: 'ord-3',
      workspaceId: 'ws-3',
      planId: 'plan-3',
      status: 'SUCCEEDED',
      fulfillmentStatus: 'PENDING',
      orderType: 'PLAN',
      credits: 0,
      snapshotJson: { orderType: 'PLAN', planId: 'plan-3' }, // 无 monthlyCredits/periodDays
    };
    const h = createHarness(baseOrder, { id: 'plan-3', name: 'Basic', monthlyCredits: 50, periodDays: 365 });

    const r = await h.svc.fulfill('ord-3');
    expect(r.status).toBe('SUCCEEDED');
    expect(r.creditsGranted).toBe(50);
    expect(h.rechargeCalls[0].amount).toBe(50);
  });

  it('order not paid: 拒绝履约', async () => {
    const baseOrder: Order = {
      id: 'ord-4',
      workspaceId: 'ws-4',
      planId: 'plan-4',
      status: 'PENDING',
      fulfillmentStatus: 'PENDING',
      orderType: 'PLAN',
      credits: 100,
      snapshotJson: { monthlyCredits: 100, periodDays: 30 },
    };
    const h = createHarness(baseOrder, { id: 'plan-4', name: 'Pro', monthlyCredits: 100, periodDays: 30 });
    await expect(h.svc.fulfill('ord-4')).rejects.toThrow();
    expect(h.insertedSubscriptions.length).toBe(0);
    expect(h.rechargeCalls.length).toBe(0);
  });
});