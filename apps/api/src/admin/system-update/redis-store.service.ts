import { Inject, Injectable } from '@nestjs/common';
import type IORedis from 'ioredis';
import { SYSTEM_UPDATE_REDIS } from './system-update.redis.js';
import type { OperationStatus, OperationView } from './types.js';

const CACHE_PREFIX = 'sysup:cache';
const LOCK_PREFIX = 'sysup:lock';
const OP_PREFIX = 'sysup:op';

/**
 * system-update 的 Redis 状态层：
 * - 更新检查结果缓存（TTL 由配置控制）
 * - 系统操作锁（SET NX + TTL，Lua 释放），防止并发 update/rollback
 * - 后台操作记录（前端轮询进度）
 * 与队列模块的 BullMQ 连接相互独立。
 */
@Injectable()
export class RedisStore {
  constructor(@Inject(SYSTEM_UPDATE_REDIS) private readonly redis: IORedis) {}

  // ---- 更新检查缓存 ----
  async getCache(): Promise<string | null> {
    return this.redis.get(CACHE_PREFIX);
  }

  async setCache(data: string, ttlMs: number): Promise<void> {
    await this.redis.set(CACHE_PREFIX, data, 'PX', ttlMs);
  }

  // ---- 操作锁 ----
  async acquireLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    const res = await this.redis.set(`${LOCK_PREFIX}:${key}`, token, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }

  async releaseLock(key: string, token: string): Promise<void> {
    // 仅当持有者仍是自己时才删除（Lua 原子）。
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(script, 1, `${LOCK_PREFIX}:${key}`, token);
    } catch {
      // 释放失败不阻塞主流程；锁有 TTL 兜底。
    }
  }

  // ---- 操作记录 ----
  async createOperation(op: OperationView): Promise<void> {
    await this.redis.hset(this.opKey(op.operation_id), this.opFields(op));
    await this.redis.expire(this.opKey(op.operation_id), 24 * 60 * 60);
  }

  async updateOperation(op: OperationView): Promise<void> {
    await this.redis.hset(this.opKey(op.operation_id), this.opFields(op));
  }

  async getOperation(operationId: string): Promise<OperationView | null> {
    const f = await this.redis.hgetall(this.opKey(operationId));
    if (!f || Object.keys(f).length === 0) return null;
    return {
      operation_id: String(f.operation_id ?? operationId),
      status: (f.status as OperationStatus) ?? 'running',
      action: (f.action as OperationView['action']) ?? 'update',
      target: f.target || undefined,
      output: f.output || undefined,
      exit_code: f.exit_code !== undefined ? Number(f.exit_code) : undefined,
      started_at: f.started_at || undefined,
      finished_at: f.finished_at || undefined,
    };
  }

  private opKey(id: string): string {
    return `${OP_PREFIX}:${id}`;
  }

  private opFields(op: OperationView): Record<string, string | number> {
    const f: Record<string, string | number> = {
      operation_id: op.operation_id,
      status: op.status,
      action: op.action,
    };
    if (op.target !== undefined) f.target = op.target;
    if (op.output !== undefined) f.output = op.output;
    if (op.exit_code !== undefined) f.exit_code = op.exit_code;
    if (op.started_at !== undefined) f.started_at = op.started_at;
    if (op.finished_at !== undefined) f.finished_at = op.finished_at;
    return f;
  }
}
