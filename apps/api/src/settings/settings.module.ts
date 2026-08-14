import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/config.module.js';
import { SettingsService, SETTINGS_REDIS } from './settings.service.js';
import { LoginAgreementService } from './login-agreement.service.js';
import { PublicLoginAgreementController } from './public-login-agreement.controller.js';

/**
 * 全局动态配置模块：SettingsService 被 Auth / Payment / Admin 等多个模块依赖，
 * 声明为全局以便直接注入，无需重复导入。
 *
 * 提供独立的 Redis 连接用于 settings pub/sub 失效广播（与 BullMQ 连接池隔离）。
 */
@Global()
@Module({
  providers: [
    {
      provide: SETTINGS_REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    },
    SettingsService,
    LoginAgreementService,
  ],
  controllers: [PublicLoginAgreementController],
  exports: [SettingsService, LoginAgreementService],
})
export class SettingsModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown() {
    // Redis 连接由 ioredis 内部管理生命周期；NestJS 关闭时由进程退出清理。
  }
}
