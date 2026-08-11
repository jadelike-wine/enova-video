import { describe, expect, it } from 'vitest';
import { CREDENTIAL_STATUSES } from '@enova/contracts';
import { CredentialsAdminService } from './credentials.admin.service.js';

function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

/** 带 values/set 捕获的 fake db，便于断言写入的 encryptedSecret 是否为密文。 */
function createDb(handlers: Record<string, () => any>) {
  const calls: Record<string, number> = {};
  const writes: any[] = [];
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
      values: (v: any) => {
        writes.push({ op: 'insert', table: tableKey(table), value: v });
        return chain;
      },
      set: (v: any) => {
        writes.push({ op: 'update', table: tableKey(table), value: v });
        return chain;
      },
      returning: () => {
        const r = next('write:' + tableKey(table));
        return Promise.resolve(r === undefined ? [] : (Array.isArray(r) ? r : [r]));
      },
    };
    return chain;
  };
  return {
    select: () => ({ from: (t: unknown) => mk(t) }),
    insert: (t: unknown) => ({ values: (v: any) => mk(t).values(v) }),
    update: (t: unknown) => ({ set: (v: any) => mk(t).set(v) }),
    delete: (t: unknown) => ({ where: () => Promise.resolve({}) }),
    __writes: writes,
  };
}

const env = { CREDENTIAL_MASTER_KEY: 'test-master-key-0123456789abcdef' } as any;

const providerRow = { id: 'p1' };
const credRow = {
  id: 'c1',
  providerId: 'p1',
  status: CREDENTIAL_STATUSES.ACTIVE,
  priority: 0,
  weight: 1,
  maxConcurrency: 1,
  currentConcurrency: 0,
  cooldownUntil: null,
  lastUsedAt: null,
  lastError: null,
  encryptedSecret: 'bGVuZ3RoeQ==', // 任意非空
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const presentProvider = { 'sel:providers': () => [providerRow] };
const emptyCred = { 'sel:provider_credentials': () => [] };

describe('CredentialsAdminService', () => {
  describe('create', () => {
    it('rejects missing provider', async () => {
      const svc = new CredentialsAdminService(createDb(emptyCred), env);
      await expect(svc.create('missing', { secret: 'sk' })).rejects.toThrowError(/Provider not found/);
    });

    it('rejects empty secret', async () => {
      const svc = new CredentialsAdminService(createDb({ ...presentProvider, ...emptyCred }), env);
      await expect(svc.create('p1', { secret: '  ' })).rejects.toThrowError(/credential secret is required/);
    });

    it('stores an encrypted secret, never plaintext', async () => {
      const db = createDb({
        ...presentProvider,
        'write:provider_credentials': () => [{ ...credRow, encryptedSecret: 'encrypted' }],
      });
      const svc = new CredentialsAdminService(db as any, env);

      const view = await svc.create('p1', { secret: 'sk-live-1' });

      // 返回视图不泄露明文
      expect(view.hasSecret).toBe(true);
      expect(JSON.stringify(view)).not.toContain('sk-live-1');
      expect((view as any).encryptedSecret).toBeUndefined();
      expect((view as any).secret).toBeUndefined();

      // 入库值是加密后的密文，而非明文
      const written = db.__writes.find((w) => w.op === 'insert')?.value;
      expect(written.encryptedSecret).toBeDefined();
      expect(String(written.encryptedSecret)).not.toContain('sk-live-1');
    });
  });

  describe('get', () => {
    it('throws CREDENTIAL_NOT_FOUND when missing', async () => {
      const svc = new CredentialsAdminService(createDb(emptyCred), env);
      await expect(svc.get('missing')).rejects.toThrowError(/Credential not found/);
    });
  });

  describe('update', () => {
    const updateDb = (handlers: Record<string, () => any>) =>
      createDb({
        'sel:provider_credentials': () => [credRow],
        'write:provider_credentials': () => [credRow],
        ...handlers,
      });

    it('keeps existing ciphertext when no new secret provided', async () => {
      const db = updateDb({});
      const svc = new CredentialsAdminService(db as any, env);
      await svc.update('c1', { priority: 5 });
      const written = db.__writes.find((w) => w.op === 'update')?.value;
      expect(written.encryptedSecret).toBe(credRow.encryptedSecret);
    });

    it('re-encrypts when a new secret is provided', async () => {
      const db = updateDb({});
      const svc = new CredentialsAdminService(db as any, env);
      await svc.update('c1', { secret: 'sk-new' });
      const written = db.__writes.find((w) => w.op === 'update')?.value;
      expect(String(written.encryptedSecret)).not.toContain('sk-new');
    });

    it('clears backoff state when requested', async () => {
      const db = updateDb({});
      const svc = new CredentialsAdminService(db as any, env);
      await svc.update('c1', { clearBackoff: true });
      const written = db.__writes.find((w) => w.op === 'update')?.value;
      expect(written.cooldownUntil).toBeNull();
      expect(written.lastError).toBeNull();
    });
  });
});