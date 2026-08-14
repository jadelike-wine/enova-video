import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TurnstileService } from './turnstile.service.js';
import { RuntimeEmailSender } from '../common/services/runtime-email.sender.js';
import { BillingModule } from '../billing/billing.module.js';
import { ENV, type Env } from '../config/config.module.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * 全局认证模块：AuthService 被 AuthGuard 在各业务模块中广泛依赖，
 * 声明为全局以避免每个模块重复导入 AuthModule。
 *
 * EMAIL_SENDER 由 RuntimeEmailSender 统一代理：
 * - test/development：ConsoleEmailSender
 * - production + SMTP configured：SmtpEmailSender
 * - production + SMTP incomplete：DisabledEmailSender（fail-closed）
 *
 * SMTP 和邮件模板配置来自 System Settings，环境变量仅作为旧部署 fallback。
 */
@Global()
@Module({
  imports: [BillingModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    TurnstileService,
    {
      provide: 'EMAIL_SENDER',
      inject: [SettingsService, ENV],
      useFactory: (settings: SettingsService, env: Env) => new RuntimeEmailSender(settings, env),
    },
  ],
  exports: [AuthService, PasswordService, SessionService, TurnstileService, 'EMAIL_SENDER'],
})
export class AuthModule {}
