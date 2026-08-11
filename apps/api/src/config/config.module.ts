import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from '@enova/config';

export const ENV = Symbol('ENV');

/**
 * 全局配置模块：解析并注入共享环境变量。
 * 所有服务通过 @Inject(ENV) 获取类型安全的配置，避免散落 process.env。
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}

export type { Env }; 
export { ENV as ENV_TOKEN };