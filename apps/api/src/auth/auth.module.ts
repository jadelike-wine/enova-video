import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TurnstileService } from './turnstile.service.js';

/**
 * 全局认证模块：AuthService 被 AuthGuard 在各业务模块中广泛依赖，
 * 声明为全局以避免每个模块重复导入 AuthModule。
 */
@Global()
@Module({
  imports: [],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, TurnstileService],
  exports: [AuthService, PasswordService, SessionService, TurnstileService],
})
export class AuthModule {}