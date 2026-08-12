import { describe, expect, it, vi } from 'vitest';
import { OutboxDispatcher } from './outbox.dispatcher.js';

/**
 * P0 红队：reconcileOrphanJobs 必须恢复"QUEUED 但 outbox 卡在 DISPATCHED/SUPERSEDED"的孤儿任务。
 *
 * 背景（Section 5B）：queue.add 成功 + outbox 已置 DISPATCHED，但 BullMQ 可能在处理前丢失 job
 * （Redis 抖动/清空），generation_job 停在 QUEUED、credits 已 RESERVED。若 reconcile 只复活
 * SUPERSEDED，则 DISPATCHED 的 PROCESS 行会同时挡住 revive（status 不匹配）和 insert
 * （唯一索引冲突 DO NOTHING）→ job 永久卡死 → 用户已扣费但任务永不执行。
 *
 * 修复：reconcile 对 QUEUED job，把 DISPATCHED 或 SUPERSEDED 的 PROCESS 行一律复活为 PENDING。
 * 安全性：BullMQ jobId = generationJobId，重复 add 幂等去重，不会重复执行/重复计费。
 */

function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

/**
 * mock db：
 * - select().from(generation_jobs) → 返回孤儿 job。
 * - update(generation_dispatch_outbox).set().where().returning() → 仅当 outbox 处于"卡死"态
 *   （DISPATCHED / SUPERSEDED）时返回一行，视为 revive 成功。
 * - insert(...).onConflictDoNothing().returning() → 无新行（表已存在 PROCESS 行）。
 */
function makeDb(options: { orphanJobs: Array<Record<string, unknown>>; outboxStatus: string }) {
  const stranded = options.outboxStatus === 'DISPATCHED' || options.outboxStatus === 'SUPERSEDED';
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(options.orphanJobs),
        }),
      }),
    }),
    update: (table: unknown) => {
      const name = tableKey(table);
      if (name !== 'generation_dispatch_outbox') return { set: () => ({ where: () => Promise.resolve([]) }) };
      return {
        set: () => ({ where: () => ({ returning: () => Promise.resolve(stranded ? [{ id: 'outbox-1' }] : []) }) }),
      };
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  };
  return db;
}

const orphanJob = {
  jobId: 'job-1',
  workspaceId: 'ws-1',
  userId: 'u-1',
  type: 'IMAGE',
  provider: 'agnes',
  model: 'm',
  inputJson: { prompt: 'x' },
  reservedCredits: 10,
};

describe('OutboxDispatcher.reconcileOrphanJobs', () => {
  it('revives a DISPATCHED PROCESS outbox for a QUEUED job (dont strand charged job)', async () => {
    // job 已 QUEUED + credits RESERVED，但 outbox 卡在 DISPATCHED（BullMQ 丢失了 job）。
    const db = makeDb({ orphanJobs: [orphanJob], outboxStatus: 'DISPATCHED' });
    const queue = { add: vi.fn(async () => ({})) } as any;
    const dispatcher = new OutboxDispatcher(db as any, queue);

    const res = await dispatcher.reconcileOrphanJobs();

    // 修复前只匹配 SUPERSEDED → DISPATCHED 返回 0，job 永久卡死；修复后必须 = 1。
    expect(res.replayed).toBe(1);
  });

  it('revives a SUPERSEDED PROCESS outbox for a QUEUED job', async () => {
    const db = makeDb({ orphanJobs: [orphanJob], outboxStatus: 'SUPERSEDED' });
    const queue = { add: vi.fn(async () => ({})) } as any;
    const dispatcher = new OutboxDispatcher(db as any, queue);

    const res = await dispatcher.reconcileOrphanJobs();

    expect(res.replayed).toBe(1);
  });

  it('does not replay when outbox is still PENDING (not stranded)', async () => {
    // PENDING 行既不该被 revive（status 不匹配）也不该被 insert（已有行）→ replayed = 0。
    const db = makeDb({ orphanJobs: [orphanJob], outboxStatus: 'PENDING' });
    const queue = { add: vi.fn(async () => ({})) } as any;
    const dispatcher = new OutboxDispatcher(db as any, queue);

    const res = await dispatcher.reconcileOrphanJobs();

    expect(res.replayed).toBe(0);
  });
});