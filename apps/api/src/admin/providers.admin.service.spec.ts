import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_STATUSES } from '@enova/contracts';
import { ProvidersAdminService } from './providers.admin.service.js';

/** 构造可链式查询的 fake db。handlers key 形如 'sel:providers' / 'write:providers'。 */
function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  // drizzle 表名存储在 Symbol.for('drizzle:Name') 上
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
        return Promise.resolve(Array.isArray(r) ? r : [r]);
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

const env = {
  NODE_ENV: 'test',
  SSRF_ALLOW_HTTP: false,
  SSRF_RESOLVE_DNS: false,
  SSRF_DEV_ALLOW_LIST: '',
} as any;

const providerRow = {
  id: 'p1',
  code: 'agnes',
  name: 'Agnes',
  baseUrl: 'https://api.agnes.example.com',
  status: PROVIDER_STATUSES.ACTIVE,
  config: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const emptySel = { 'sel:providers': () => [] };

/** Mock SettingsService：返回 null 让 SSRF 配置走 env 兜底。 */
const mockSettings = {
  getBoolean: vi.fn().mockResolvedValue(null),
  getString: vi.fn().mockResolvedValue(null),
  getNumber: vi.fn().mockResolvedValue(null),
} as any;

describe('ProvidersAdminService', () => {
  describe('create', () => {
    it('rejects empty provider code', async () => {
      const svc = new ProvidersAdminService(createDb(emptySel), env, mockSettings);
      await expect(svc.create({ code: '  ', name: 'x', baseUrl: 'https://a.example.com' }))
        .rejects.toThrowError(/provider code is required/);
    });

    it('rejects missing base_url', async () => {
      const svc = new ProvidersAdminService(createDb(emptySel), env, mockSettings);
      await expect(svc.create({ code: 'agnes', name: 'x', baseUrl: '  ' }))
        .rejects.toThrowError(/base_url is required/);
    });

    it('blocks private-network base_url (SSRF)', async () => {
      const svc = new ProvidersAdminService(createDb(emptySel), env, mockSettings);
      await expect(svc.create({ code: 'agnes', name: 'x', baseUrl: 'https://127.0.0.1:9000' }))
        .rejects.toThrowError(/Blocked host/);
    });

    it('rejects duplicate provider code with 409', async () => {
      const svc = new ProvidersAdminService(createDb({ 'sel:providers': () => [providerRow] }), env, mockSettings);
      await expect(svc.create({ code: 'agnes', name: 'dup', baseUrl: 'https://api.agnes.example.com' }))
        .rejects.toThrowError(/already exists/);
    });

    it('creates a provider with default ACTIVE status', async () => {
      const svc = new ProvidersAdminService(
        createDb({ 'sel:providers': () => [], 'write:providers': () => [providerRow] }),
        env,
        mockSettings,
      );
      const view = await svc.create({ code: 'agnes', name: 'Agnes', baseUrl: 'https://api.agnes.example.com' });
      expect(view.id).toBe('p1');
      expect(view.status).toBe(PROVIDER_STATUSES.ACTIVE);
    });
  });

  describe('ensureAgnesProvider', () => {
    it('returns existing provider if already present', async () => {
      const svc = new ProvidersAdminService(
        createDb({ 'sel:providers': () => [providerRow] }),
        env,
        mockSettings,
      );
      const view = await svc.ensureAgnesProvider();
      expect(view.id).toBe('p1');
      expect(view.code).toBe('agnes');
    });

    it('creates agnes provider with fixed config if not present', async () => {
      const agnesRow = {
        ...providerRow,
        baseUrl: 'https://apihub.agnes-ai.com',
        name: 'Agnes',
      };
      const svc = new ProvidersAdminService(
        createDb({ 'sel:providers': () => [], 'write:providers': () => [agnesRow] }),
        env,
        mockSettings,
      );
      const view = await svc.ensureAgnesProvider();
      expect(view.id).toBe('p1');
      expect(view.code).toBe('agnes');
      expect(view.name).toBe('Agnes');
      expect(view.baseUrl).toBe('https://apihub.agnes-ai.com');
      expect(view.status).toBe(PROVIDER_STATUSES.ACTIVE);
    });
  });

  describe('get', () => {
    it('throws 404 when provider not found', async () => {
      const svc = new ProvidersAdminService(createDb(emptySel), env, mockSettings);
      await expect(svc.get('missing')).rejects.toThrowError(/Provider not found/);
    });
  });

  describe('update', () => {
    it('updates fields and keeps unchanged values', async () => {
      const svc = new ProvidersAdminService(
        createDb({ 'sel:providers': () => [providerRow], 'write:providers': () => [{ ...providerRow, name: 'Agnes v2' }] }),
        env,
        mockSettings,
      );
      const view = await svc.update('p1', { name: 'Agnes v2' });
      expect(view.name).toBe('Agnes v2');
      expect(view.baseUrl).toBe(providerRow.baseUrl);
    });

    it('re-validates base_url when it changes', async () => {
      const svc = new ProvidersAdminService(
        createDb({ 'sel:providers': () => [providerRow] }),
        env,
        mockSettings,
      );
      await expect(svc.update('p1', { baseUrl: 'https://192.168.1.1' })).rejects.toThrowError(/Blocked host/);
    });

    it('throws 404 when updating a missing provider', async () => {
      const svc = new ProvidersAdminService(createDb(emptySel), env, mockSettings);
      await expect(svc.update('missing', { name: 'x' })).rejects.toThrowError(/Provider not found/);
    });
  });

  describe('remove', () => {
    it('deletes an existing provider', async () => {
      const del = vi.fn(() => Promise.resolve({}));
      const db: any = createDb({ 'sel:providers': () => [providerRow] });
      db.delete = () => ({ where: del });
      const svc = new ProvidersAdminService(db, env, mockSettings);
      await svc.remove('p1');
      expect(del).toHaveBeenCalled();
    });

    it('throws 404 when removing a missing provider', async () => {
      const svc = new ProvidersAdminService(createDb(emptySel), env, mockSettings);
      await expect(svc.remove('missing')).rejects.toThrowError(/Provider not found/);
    });
  });
});