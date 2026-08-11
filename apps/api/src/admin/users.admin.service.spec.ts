import { describe, expect, it, vi } from 'vitest';
import { UsersAdminService } from './users.admin.service.js';

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
  const mk = (table: unknown) => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(next('sel:' + tableKey(table))),
      orderBy: () => chain,
      offset: () => chain,
      values: () => chain,
      set: () => chain,
      returning: () => {
        const r = next('write:' + tableKey(table));
        return Promise.resolve(r === undefined ? [] : (Array.isArray(r) ? r : [r]));
      },
    };
    return chain;
  };
  return {
    select: () => ({ from: (t: unknown) => mk(t) }),
    insert: (t: unknown) => ({ values: () => mk(t) }),
    update: (t: unknown) => ({ set: () => mk(t) }),
    delete: (t: unknown) => ({ where: () => Promise.resolve({}) }),
  };
}

const userRow = {
  id: 'u1',
  email: 'admin@example.com',
  role: 'ADMIN',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01'),
};
const membershipRow = { workspaceId: 'ws1', role: 'OWNER' };
const walletRow = { balance: 100, reservedBalance: 20 };

function makeWallet(overrides: { balance?: number } = {}) {
  return { adjustBalance: vi.fn(async () => ({ balance: overrides.balance ?? 130 })) } as any;
}

describe('UsersAdminService', () => {
  describe('adjustCredits', () => {
    it('throws when user has no workspace', async () => {
      const db = createDb({ 'sel:users': () => [userRow], 'sel:workspace_members': () => [] });
      const svc = new UsersAdminService(db as any, makeWallet());
      await expect(svc.adjustCredits('u1', 100)).rejects.toThrowError(/no workspace|workspace/i);
    });

    it('throws 404 for unknown user', async () => {
      const db = createDb({ 'sel:users': () => [] });
      const svc = new UsersAdminService(db as any, makeWallet());
      await expect(svc.adjustCredits('missing', 100)).rejects.toThrowError(/User not found/);
    });

    it('adjusts balance via WalletService and returns reserved balance', async () => {
      const db = createDb({
        'sel:users': () => [userRow],
        'sel:workspace_members': () => [membershipRow],
        'sel:wallets': () => [walletRow],
      });
      const wallet = makeWallet({ balance: 130 });
      const svc = new UsersAdminService(db as any, wallet);

      const result = await svc.adjustCredits('u1', 30, 'manual top-up');

      expect(wallet.adjustBalance).toHaveBeenCalledWith('ws1', 30, expect.stringMatching(/^admin:adjust:/), 'manual top-up');
      expect(result).toEqual({ balance: 130, reservedBalance: 20 });
    });

    it('supports negative deltas (debit)', async () => {
      const db = createDb({
        'sel:users': () => [userRow],
        'sel:workspace_members': () => [membershipRow],
        'sel:wallets': () => [walletRow],
      });
      const wallet = makeWallet({ balance: 70 });
      const svc = new UsersAdminService(db as any, wallet);
      const result = await svc.adjustCredits('u1', -30, 'refund');
      expect(wallet.adjustBalance).toHaveBeenCalledWith('ws1', -30, expect.stringMatching(/^admin:adjust:/), 'refund');
      expect(result.balance).toBe(70);
    });
  });
});