import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Database } from '@enova/db';
import { ENV, type Env } from '../config/config.module.js';

export const DATABASE = Symbol('DATABASE');

/**
 * 全局数据库模块：基于 DATABASE_URL 创建共享连接池，
 * 并在应用关闭时释放，避免连接泄漏。
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ENV],
      useFactory: (env: Env): Database => createDb(env.DATABASE_URL),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}