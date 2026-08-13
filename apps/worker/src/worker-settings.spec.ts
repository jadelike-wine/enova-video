/**
 * WorkerSettings 单元测试：Worker concurrency 优先级、TTL 缓存、applyLogSettings。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerSettings } from './worker-settings.js';
import type { SettingsCrypto } from '@enova/db';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockDbRow {
  key: string;
  value: string;
  valueType: string;
  group: string;
  isSecret: boolean;
  version: number;
}

function createMockDb(initialRows: MockDbRow[] = []) {
  const rows = new Map<string, MockDbRow>();
  for (const r of initialRows) rows.set(r.key, r);

  const db: any = {
    select: () => ({
      from: () => ({
        where: (filter: any) => {
          // extract key from filter
          const keyVal = extractKey(filter);
          const filtered = keyVal ? (rows.has(keyVal) ? [rows.get(keyVal)!] : []) : Array.from(rows.values());
          return {
            limit: async () => filtered.slice(0, 1),
            orderBy: () => ({ limit: async () => filtered.slice(0, 1) }),
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: any) => ({
        onConflictDoNothing: async () => {
          if (!rows.has(v.key)) {
            rows.set(v.key, { key: v.key, value: v.value, valueType: v.valueType ?? 'string', group: v.group ?? 'general', isSecret: v.isSecret ?? false, version: v.version ?? 1 });
          }
        },
        then: async (resolve: any) => {
          rows.set(v.key, { key: v.key, value: v.value, valueType: v.valueType ?? 'string', group: v.group ?? 'general', isSecret: v.isSecret ?? false, version: v.version ?? 1 });
          resolve(undefined);
        },
      }),
    }),
    transaction: async (cb: (tx: any) => Promise<any>) => cb(db),
  };

  return { db, rows };
}

function extractKey(filter: any): string | undefined {
  if (!filter) return undefined;
  if (typeof filter === 'object' && 'value' in filter) {
    const v = (filter as any).value;
    if (typeof v === 'string' && v.includes('.')) return v;
  }
  const chunks = (filter as any).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      const k = extractKey(chunk);
      if (k) return k;
    }
  }
  return undefined;
}

function createMockRedis() {
  const subscribers = new Map<string, Array<(channel: string, message: string) => void>>();
  return {
    publish: vi.fn(async (channel: string, message: string) => {
      const handlers = subscribers.get(channel) || [];
      for (const h of handlers) h(channel, message);
      return 1;
    }),
    subscribe: vi.fn((channel: string) => {
      // Ensure handlers array exists
    }),
    on: vi.fn((event: string, handler: (channel: string, message: string) => void) => {
      if (event === 'message') {
        if (!subscribers.has('enova:settings:invalidate')) {
          subscribers.set('enova:settings:invalidate', []);
        }
        subscribers.get('enova:settings:invalidate')!.push(handler);
      }
    }),
    duplicate: function () { return this; },
    quit: vi.fn(async () => {}),
    _subscribers: subscribers,
  };
}

function createMockLogger() {
  return {
    reconfigure: vi.fn(),
    setLevel: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkerSettings', () => {
  describe('worker concurrency priority', () => {
    it('uses DB value when available (DB > env > default)', async () => {
      const { db } = createMockDb([
        { key: 'queue.workerConcurrency', value: '13', valueType: 'number', group: 'queue', isSecret: false, version: 1 },
      ]);
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: { BULLMQ_CONCURRENCY: 5 },
        redis: redis as any,
        logger: logger as any,
      });

      const concurrency = await settings.getNumber('queue.workerConcurrency');
      expect(concurrency).toBe(13);
    });

    it('falls back to env when DB is absent', async () => {
      const { db } = createMockDb();
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: { BULLMQ_CONCURRENCY: 7 },
        redis: redis as any,
        logger: logger as any,
      });

      const concurrency = await settings.getNumber('queue.workerConcurrency');
      expect(concurrency).toBe(7);
    });

    it('falls back to registry default when DB and env are absent', async () => {
      const { db } = createMockDb();
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: {},
        redis: redis as any,
        logger: logger as any,
      });

      const concurrency = await settings.getNumber('queue.workerConcurrency');
      expect(concurrency).toBe(3); // registry default
    });
  });

  describe('cache TTL fallback', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns cached value within TTL', async () => {
      const { db, rows } = createMockDb([
        { key: 'video.pollIntervalMs', value: '15000', valueType: 'number', group: 'queue', isSecret: false, version: 1 },
      ]);
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: {},
        redis: redis as any,
        logger: logger as any,
      });

      // First read: from DB
      const val1 = await settings.getNumber('video.pollIntervalMs');
      expect(val1).toBe(15000);

      // Change DB value without invalidation
      rows.set('video.pollIntervalMs', { ...rows.get('video.pollIntervalMs')!, value: '99999' });

      // Within TTL: should still return cached value
      const val2 = await settings.getNumber('video.pollIntervalMs');
      expect(val2).toBe(15000); // cached

      // Advance past TTL (30s)
      vi.advanceTimersByTime(31_000);

      // After TTL: should reload from DB
      const val3 = await settings.getNumber('video.pollIntervalMs');
      expect(val3).toBe(99999);
    });
  });

  describe('Redis pub/sub cache invalidation', () => {
    it('clears cache on invalidation message', async () => {
      const { db, rows } = createMockDb([
        { key: 'video.pollIntervalMs', value: '15000', valueType: 'number', group: 'queue', isSecret: false, version: 1 },
      ]);
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: {},
        redis: redis as any,
        logger: logger as any,
      });

      // First read: caches value
      const val1 = await settings.getNumber('video.pollIntervalMs');
      expect(val1).toBe(15000);

      // Change DB value
      rows.set('video.pollIntervalMs', { ...rows.get('video.pollIntervalMs')!, value: '25000', version: 2 });

      // Simulate Redis invalidation message
      await redis.publish('enova:settings:invalidate', JSON.stringify({ key: 'video.pollIntervalMs', version: 2 }));

      // Give time for the async handler to process
      await vi.waitFor(() => {
        // next read should return new value
      }, { timeout: 1000 });

      const val2 = await settings.getNumber('video.pollIntervalMs');
      expect(val2).toBe(25000); // reloaded from DB after invalidation
    });
  });

  describe('applyLogSettings', () => {
    it('reads log.level and log.format from DB and calls logger.reconfigure', async () => {
      const { db } = createMockDb([
        { key: 'log.level', value: 'debug', valueType: 'enum', group: 'log', isSecret: false, version: 1 },
        { key: 'log.format', value: 'json', valueType: 'enum', group: 'log', isSecret: false, version: 1 },
      ]);
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: {},
        redis: redis as any,
        logger: logger as any,
      });

      await settings.applyLogSettings();

      expect(logger.reconfigure).toHaveBeenCalledWith({
        level: 'debug',
        format: 'json',
      });
    });

    it('falls back to defaults when DB is empty', async () => {
      const { db } = createMockDb();
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: {},
        redis: redis as any,
        logger: logger as any,
      });

      await settings.applyLogSettings();

      expect(logger.reconfigure).toHaveBeenCalledWith({
        level: 'info',
        format: 'text',
      });
    });
  });

  describe('getStorageConfig', () => {
    it('throws for unsupported provider (e.g. legacy qiniu)', async () => {
      const { db } = createMockDb([
        { key: 'storage.provider', value: 'qiniu', valueType: 'enum', group: 'storage', isSecret: false, version: 1 },
      ]);
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: { STORAGE_PROVIDER: 'none' },
        redis: redis as any,
        logger: logger as any,
      });

      await expect(
        settings.getStorageConfig({
          STORAGE_PROVIDER: 'none',
          S3_REGION: '', S3_BUCKET: '', S3_PREFIX: 'enova',
          S3_PUBLIC_BASE_URL: '', S3_ENDPOINT_URL: '',
          S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
          STORAGE_MAX_BYTES: 1000, STORAGE_DOWNLOAD_TIMEOUT_MS: 1000,
          STORAGE_ALLOWED_CONTENT_TYPES: 'image/',
          SSRF_ALLOW_HTTP: true, SSRF_DEV_ALLOW_LIST: '',
          SSRF_RESOLVE_DNS: false, NODE_ENV: 'development',
        }),
      ).rejects.toThrow(/Unsupported storage.provider "qiniu"/);
    });

    it('accepts valid provider none', async () => {
      const { db } = createMockDb([
        { key: 'storage.provider', value: 'none', valueType: 'enum', group: 'storage', isSecret: false, version: 1 },
      ]);
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: {},
        redis: redis as any,
        logger: logger as any,
      });

      const config = await settings.getStorageConfig({
        STORAGE_PROVIDER: 'none',
        S3_REGION: '', S3_BUCKET: '', S3_PREFIX: 'enova',
        S3_PUBLIC_BASE_URL: '', S3_ENDPOINT_URL: '',
        S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
        STORAGE_MAX_BYTES: 1000, STORAGE_DOWNLOAD_TIMEOUT_MS: 1000,
        STORAGE_ALLOWED_CONTENT_TYPES: 'image/',
        SSRF_ALLOW_HTTP: true, SSRF_DEV_ALLOW_LIST: '',
        SSRF_RESOLVE_DNS: false, NODE_ENV: 'development',
      });
      expect(config.provider).toBe('none');
    });

    it('accepts valid provider s3', async () => {
      const { db } = createMockDb([
        { key: 'storage.provider', value: 's3', valueType: 'enum', group: 'storage', isSecret: false, version: 1 },
      ]);
      const redis = createMockRedis();
      const logger = createMockLogger();
      const settings = new WorkerSettings({
        db: db as any,
        env: {},
        redis: redis as any,
        logger: logger as any,
      });

      const config = await settings.getStorageConfig({
        STORAGE_PROVIDER: 'none',
        S3_REGION: '', S3_BUCKET: '', S3_PREFIX: 'enova',
        S3_PUBLIC_BASE_URL: '', S3_ENDPOINT_URL: '',
        S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
        STORAGE_MAX_BYTES: 1000, STORAGE_DOWNLOAD_TIMEOUT_MS: 1000,
        STORAGE_ALLOWED_CONTENT_TYPES: 'image/',
        SSRF_ALLOW_HTTP: true, SSRF_DEV_ALLOW_LIST: '',
        SSRF_RESOLVE_DNS: false, NODE_ENV: 'development',
      });
      expect(config.provider).toBe('s3');
    });
  });
});