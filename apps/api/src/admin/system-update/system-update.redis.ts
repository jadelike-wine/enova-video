import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import IORedis from 'ioredis';
import type { Env } from '../../config/config.module.js';

/** system-update 独立 Redis 连接（与队列模块的 BullMQ 连接隔离）。 */
export const SYSTEM_UPDATE_REDIS = Symbol('SYSTEM_UPDATE_REDIS');

@Injectable()
export class SystemUpdateRedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(SYSTEM_UPDATE_REDIS) private readonly redis: IORedis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

export function createSystemUpdateRedis(env: Env): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}