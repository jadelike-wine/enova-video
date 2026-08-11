import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';

/**
 * 全局动态配置模块：SettingsService 被 Auth / Payment / Admin 等多个模块依赖，
 * 声明为全局以便直接注入，无需重复导入。
 */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}