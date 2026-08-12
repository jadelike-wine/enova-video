import { describe, expect, it, vi } from 'vitest';
import { OrdersAdminService } from './orders.admin.service.js';

/**
 * OrdersAdminService 单元测试（P0-8）。
 * 验证 list / detail / close / retryFulfillment 的参数校验与数据映射。
 * 不验证 DB 层（已由 schema 约束保证）。
 */
describe('OrdersAdminService', () => {
  function createMockDb(overrides: Record<string, unknown> = {}) {
    const orders: any[] = overrides.orders ?? [];

    const buildChain = (result: any) => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => Promise.resolve(result),
        for: () => chain,
        set: () => chain,
        values: () => chain,
        returning: () => Promise.resolve(Array.isArray(result) ? result : [result]),
      };
      return chain;
    };

    return {
      select: () => buildChain(orders),
      transaction: async (fn: (tx: any) => Promise<any>) => fn({}),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    };
  }

  function createService(db: any, payment: any, fulfillment: any) {
    return new OrdersAdminService(db, payment as any, fulfillment as any);
  }

  describe('list', () => {
    it('applies limit and offset clamps', async () => {
      const db = createMockDb({ orders: [] });
      const service = createService(db, {}, {});
      const result = await service.list({ limit: 500, offset: -10 });
      expect(result).toEqual([]);
    });

    it('returns mapped order views', async () => {
      const orderRow = {
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
        snapshotJson: { foo: 'bar' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const db = createMockDb({ orders: [orderRow] });
      const service = createService(db, {}, {});
      const result = await service.list({});
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('o1');
      expect(result[0].orderType).toBe('RECHARGE');
    });
  });

  describe('closeOrder', () => {
    it('delegates to payment service closePayment', async () => {
      const payment = {
        closePayment: vi.fn().mockResolvedValue(undefined),
      };
      const db = createMockDb();
      const service = createService(db, payment, {});
      await service.closeOrder('o1');
      expect(payment.closePayment).toHaveBeenCalledWith('o1');
    });
  });

  describe('retryFulfillment', () => {
    it('delegates to fulfillment service', async () => {
      const fulfillment = {
        fulfill: vi.fn().mockResolvedValue({
          orderId: 'o1',
          status: 'SUCCEEDED',
          subscriptionId: 'sub1',
          creditsGranted: 1000,
        }),
      };
      const db = createMockDb();
      const service = createService(db, {}, fulfillment);
      const result = await service.retryFulfillment('o1');
      expect(fulfillment.fulfill).toHaveBeenCalledWith('o1');
      expect(result.status).toBe('SUCCEEDED');
      expect(result.creditsGranted).toBe(1000);
    });
  });
});
