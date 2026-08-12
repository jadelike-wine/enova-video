import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller.js';

/**
 * 首启 Setup 模块：依赖全局 AuthModule 提供的 AuthService，
 * 提供是否需要初始化管理员的探测与创建接口。
 */
@Module({
  controllers: [SetupController],
})
export class SetupModule {}