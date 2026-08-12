import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service.js';

/** 极简 DB mock：记录 upsert 与 select 行为。 */
function createDb(rows: Record<string, any[]> = {}) {
  const records: Record<string, { value: string }> = {};
  return {
    records,
    db: {
      select: () => ({
        from: (t: any) => {
          const key = tinyKey(t);
          const chain: any = {
            where: () => ({
              limit: async () => rows[key] ?? (Object.keys(records).includes(key) ? [{ value: records[key].value }] : []),
            }),
          };
          // select().from(t) 直接结尾（list() 全量读取）
          chain.then = undefined;
          Object.defineProperty(chain, 'map', {
            get: () => (fn: any) => (rows[key] ?? []).map(fn),
          });
          return chain;
        },
      }),
      insert: (t: any) => {
        const key = tinyKey(t);
        return {
          values: (v: any) => ({
            onConflictDoUpdate: async () => {
              records[key] = { value: v.value };
            },
          }),
        };
      },
    },
  };
}

function tinyKey(t: any): string {
  if (typeof t === 'string') return t;
  const n = (t as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof n === 'string' ? n : String(t);
}

const env: Record<string, unknown> = {
  WELCOME_CREDITS: 200,
  PAYMENT_CREDITS_PER_CNY: 100,
  PAYMENT_MIN_RECHARGE_CENTS: 50,
};

describe('SettingsService', () => {
  it('falls back to env/default when not persisted', async () => {
    const { db } = createDb();
    const svc = new SettingsService(db as any, env as any);
    expect(await svc.getNumber('billing.welcomeCredits')).toBe(200); // env
    expect(await svc.getBoolean('billing.someMissing')).toBeNull();
  });

  it('returns persisted value over env', async () => {
    const { db, records } = createDb();
    const svc = new SettingsService(db as any, env as any);
    await svc.set('billing.welcomeCredits', '500');
    expect(records['settings']).toEqual({ value: '500' });
    expect(await svc.getNumber('billing.welcomeCredits')).toBe(500);
  });

  it('ignores unknown keys on write', async () => {
    const { db } = createDb();
    const svc = new SettingsService(db as any, env as any);
    await expect(svc.set('not.registered', 'x')).resolves.toBeUndefined();
  });

  it('lists all registered settings with current effective values', async () => {
    const { db } = createDb();
    const svc = new SettingsService(db as any, env as any);
    const list = await svc.list();
    expect(list.length).toBeGreaterThan(0);
    const welcome = list.find((s) => s.key === 'billing.welcomeCredits')!;
    expect(welcome.value).toBe('200');
    expect(welcome.persisted).toBe(false);
  });
});