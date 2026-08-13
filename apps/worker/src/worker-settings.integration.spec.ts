/**
 * WorkerSettings 集成测试（需要真实 PostgreSQL + Redis）。
 * 启动: docker compose -f docker-compose.dev.yml up -d
 * 运行: pnpm --filter @enova/worker test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { createDb } from '@enova/db';
import { WorkerSettings } from './worker-settings.js';
import type { WorkerLogger } from './logger.js';

const PG_URL = 'postgresql://enova:enova@localhost:5432/enova';
const REDIS_URL = 'redis://localhost:6379';

// CI 无本地 PostgreSQL/Redis，无 DATABASE_URL 时整组跳过（与仓库其他集成测试一致）。
const hasLocalServices = !!process.env.DATABASE_URL;

let db1: ReturnType<typeof createDb>;
let db2: ReturnType<typeof createDb>;
let redis1: IORedis;
let redis2: IORedis;
let redisPub: IORedis;
let settings1: WorkerSettings;
let settings2: WorkerSettings;

function createSilentLogger(): WorkerLogger & { calls: any[] } {
  const calls: any[] = [];
  return {
    reconfigure: (...args: any[]) => { calls.push({ method: 'reconfigure', args }); },
    setLevel: (...args: any[]) => { calls.push({ method: 'setLevel', args }); },
    info: (...args: any[]) => { calls.push({ method: 'info', args }); },
    warn: (...args: any[]) => { calls.push({ method: 'warn', args }); },
    error: (...args: any[]) => { calls.push({ method: 'error', args }); },
    debug: (...args: any[]) => { calls.push({ method: 'debug', args }); },
    fatal: (...args: any[]) => { calls.push({ method: 'fatal', args }); },
    calls,
  } as any;
}

beforeAll(async () => {
  if (!hasLocalServices) return;
  db1 = createDb(PG_URL);
  db2 = createDb(PG_URL);
  redis1 = new IORedis(REDIS_URL);
  redis2 = new IORedis(REDIS_URL);
  redisPub = new IORedis(REDIS_URL);

  // Clean up any existing settings
  await db1.execute('DELETE FROM settings_history');
  await db1.execute('DELETE FROM settings');

  const logger1 = createSilentLogger();
  const logger2 = createSilentLogger();

  settings1 = new WorkerSettings({
    db: db1,
    env: {},
    redis: redis1,
    logger: logger1 as any,
  });

  settings2 = new WorkerSettings({
    db: db2,
    env: {},
    redis: redis2,
    logger: logger2 as any,
  });
});

afterAll(async () => {
  if (!hasLocalServices) return;
  await settings1?.close();
  await settings2?.close();
  await redis1?.quit();
  await redis2?.quit();
  await redisPub?.quit();
  await db1?.$client.end();
  await db2?.$client.end();
});

/**
 * Poll helper: 等待条件满足，最多等待 timeoutMs。
 */
async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

describe.skipIf(!hasLocalServices)('WorkerSettings Redis integration (real PG + Redis)', () => {
  describe('Redis pub/sub cache invalidation', () => {
    it('WorkerSettings reloads DB value after receiving invalidation', async () => {
      // 1. Write initial value to DB
      await db1.execute("INSERT INTO settings (key, value, value_type, \"group\", is_secret, version) VALUES ('video.pollIntervalMs', '15000', 'number', 'queue', false, 1) ON CONFLICT (key) DO UPDATE SET value = '15000', version = 1");

      // 2. WorkerSettings reads and caches 15000
      const val1 = await settings1.getNumber('video.pollIntervalMs');
      expect(val1).toBe(15000);

      // 3. Update DB to 25000
      await db1.execute("UPDATE settings SET value = '25000', version = 2 WHERE key = 'video.pollIntervalMs'");

      // 4. Publish invalidation via Redis
      await redisPub.publish('enova:settings:invalidate', JSON.stringify({ key: 'video.pollIntervalMs', version: 2 }));

      // 5. Wait for settings1 to receive invalidation and clear cache
      await pollUntil(async () => {
        const val = await settings1.getNumber('video.pollIntervalMs');
        return val === 25000;
      });

      const val2 = await settings1.getNumber('video.pollIntervalMs');
      expect(val2).toBe(25000);
    });
  });

  describe('multi-subscriber invalidation', () => {
    it('both WorkerSettings instances receive invalidation', async () => {
      // 1. Write initial value
      await db1.execute("INSERT INTO settings (key, value, value_type, \"group\", is_secret, version) VALUES ('video.maxPolls', '100', 'number', 'queue', false, 1) ON CONFLICT (key) DO UPDATE SET value = '100', version = 1");

      // 2. Both instances read and cache
      const val1a = await settings1.getNumber('video.maxPolls');
      const val1b = await settings2.getNumber('video.maxPolls');
      expect(val1a).toBe(100);
      expect(val1b).toBe(100);

      // 3. Update DB
      await db1.execute("UPDATE settings SET value = '200', version = 2 WHERE key = 'video.maxPolls'");

      // 4. Publish invalidation
      await redisPub.publish('enova:settings:invalidate', JSON.stringify({ key: 'video.maxPolls', version: 2 }));

      // 5. Both instances should reload
      await pollUntil(async () => {
        const a = await settings1.getNumber('video.maxPolls');
        const b = await settings2.getNumber('video.maxPolls');
        return a === 200 && b === 200;
      });

      const val2a = await settings1.getNumber('video.maxPolls');
      const val2b = await settings2.getNumber('video.maxPolls');
      expect(val2a).toBe(200);
      expect(val2b).toBe(200);
    });
  });

  describe('applyLogSettings', () => {
    it('reads log.level and log.format from DB', async () => {
      // Write log settings to DB
      await db1.execute("INSERT INTO settings (key, value, value_type, \"group\", is_secret, version) VALUES ('log.level', 'debug', 'enum', 'log', false, 1) ON CONFLICT (key) DO UPDATE SET value = 'debug', version = 1");
      await db1.execute("INSERT INTO settings (key, value, value_type, \"group\", is_secret, version) VALUES ('log.format', 'json', 'enum', 'log', false, 1) ON CONFLICT (key) DO UPDATE SET value = 'json', version = 1");

      const logger = createSilentLogger();
      const settings = new WorkerSettings({
        db: db1,
        env: {},
        redis: redis1,
        logger: logger as any,
      });

      await settings.applyLogSettings();

      expect(logger.calls.find((c: any) => c.method === 'reconfigure')).toBeDefined();
      const reconfigureCall = logger.calls.find((c: any) => c.method === 'reconfigure');
      expect(reconfigureCall!.args[0]).toEqual({ level: 'debug', format: 'json' });
    });
  });
});