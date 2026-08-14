import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TurnstileService } from './turnstile.service.js';
import { ConsoleEmailSender } from '../common/services/console-email.sender.js';
import { DisabledEmailSender } from '../common/services/disabled-email.sender.js';
import { SmtpEmailSender } from '../common/services/smtp-email.sender.js';
import { BillingModule } from '../billing/billing.module.js';
import { ENV, type Env } from '../config/config.module.js';
import type { EmailSender } from '../common/services/email-sender.interface.js';

/**
 * 全局认证模块：AuthService 被 AuthGuard 在各业务模块中广泛依赖，
 * 声明为全局以避免每个模块重复导入 AuthModule。
 *
 * EMAIL_SENDER 选择策略（P0-1）：
 * - test：ConsoleEmailSender（token 打印到日志，方便测试断言）
 * - development：ConsoleEmailSender（token 打印到日志，方便本地开发）
 * - production + SMTP configured：SmtpEmailSender（真实 SMTP 发送）
 * - production + SMTP not configured：DisabledEmailSender（fail-closed，启动时 loadEnv 已拒绝）
 *
 * 生产环境 loadEnv() 已强制要求 SMTP_HOST/USER/PASSWORD/FROM_EMAIL，
 * 所以生产环境下必定使用 SmtpEmailSender。
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
      inject: [ENV],
      useFactory: (env: Env): EmailSender => {
        const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
        if (isDev) {
          return new ConsoleEmailSender();
        }
        // Production: SMTP is required (validated by loadEnv).
        if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM_EMAIL) {
          return new SmtpEmailSender({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            user: env.SMTP_USER,
            password: env.SMTP_PASSWORD,
            fromName: env.SMTP_FROM_NAME,
            fromEmail: env.SMTP_FROM_EMAIL,
            resetUrl: env.APP_PASSWORD_RESET_URL,
            verifyUrl: env.APP_EMAIL_VERIFY_URL,
            appName: env.APP_NAME,
          });
        }
        // Fallback: fail-closed (should not reach here in production due to loadEnv validation).
        return new DisabledEmailSender();
      },
    },
  ],
  exports: [AuthService, PasswordService, SessionService, TurnstileService, 'EMAIL_SENDER'],
})
export class AuthModule {}
