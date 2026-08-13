import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES } from '@enova/contracts';
import { ENV, type Env } from '../config/config.module.js';

export const GENERATION_QUEUE = Symbol('GENERATION_QUEUE');

/**
 * 全局队列模块：持有 BullMQ Queue 生产者（API 侧）。
 * Worker 进程独立创建连接，不共用此连接（避免连接数竞争）。
 *
 * 注意：attempts/backoff 不在此处静态设置 defaultJobOptions，
 * 而是由各 producer（OutboxDispatcher / GenerationsService）在每次
 * queue.add() 时从动态配置读取并传入，确保管理员修改后新 job 立即生效。
 * removeOnComplete/removeOnFail 为队列级驻留策略，保留在 defaultJobOptions。
 */
@Global()
@Module({
  providers: [
    {
      provide: GENERATION_QUEUE,
      inject: [ENV],
      useFactory: (env: Env): Queue => {
        const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
        return new Queue(QUEUES.GENERATION, {
          connection,
          prefix: env.BULLMQ_PREFIX,
          defaultJobOptions: {
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        });
      },
    },
  ],
  exports: [GENERATION_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(GENERATION_QUEUE) private readonly queue: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}