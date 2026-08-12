import { describe, expect, it } from 'vitest';
import { StatsAdminService } from './stats.admin.service.js';

function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

/**
 * 构造满足 StatsAdminService.summary 的 db mock。
 * summary 按以下顺序执行查询：
 *   1. count(users)
 *   2. count(workspaces)
 *   3. count(generation_jobs)
 *   4. groupBy(generation_jobs.status)
 *   5. groupBy(generation_jobs.type)
 *   6. sum(wallets.balance / reservedBalance)
 *   7. sum(credit_reservations.capturedCredits)  <- totalCreditsSpent 口径
 *
 * 返回的查询链既是 thenable（可直接 await 得到数组），又支持 groupBy/limit/where 链式调用。
 */
function createDb(handlers: Record<string, () => any>) {
  const calls: Record<string, number> = {};
  const result = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1;
    return handlers[key] ? handlers[key](calls[key]) : [];
  };
  const mk = (table: unknown) => {
    const key = 'sel:' + tableKey(table);
    const chain: any = {
      then: (resolve: (v: any[]) => void) => {
        resolve(result(key));
      },
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      offset: () => chain,
    };
    return chain;
  };
  return {
    select: () => ({ from: (t: unknown) => mk(t) }),
  };
}

describe('StatsAdminService.totalCreditsSpent', () => {
  it('computes totalCreditsSpent from credit_reservations.capturedCredits, not GENERATION_SETTLE.amount', async () => {
    // Job A capture 100, Job B capture 200 -> totalCreditsSpent = 300
    const db = createDb({
      'sel:users': () => [{ n: 2 }],
      'sel:workspaces': () => [{ n: 1 }],
      'sel:generation_jobs': (call) => {
        if (call === 1) return [{ n: 3 }]; // count
        if (call === 2) return [{ status: 'SUCCEEDED', n: 2 }]; // byStatus
        return [{ type: 'VIDEO', n: 2 }]; // byType
      },
      'sel:wallets': () => [{ balance: 500, reserved: 100 }],
      'sel:credit_reservations': () => [{ n: 300 }], // totalCreditsSpent
    });

    const svc = new StatsAdminService(db as any);
    const view = await svc.summary();

    expect(view.totalCreditsSpent).toBe(300);
    expect(view.users).toBe(2);
    expect(view.workspaces).toBe(1);
    expect(view.generations).toBe(3);
    expect(view.totalBalance).toBe(500);
    expect(view.totalReservedBalance).toBe(100);
    expect(view.generationsByStatus).toEqual({ SUCCEEDED: 2 });
    expect(view.generationsByType).toEqual({ VIDEO: 2 });
  });
});