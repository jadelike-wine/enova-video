import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TurnstileService } from './turnstile.service.js';
import { ConsoleEmailSender } from '../common/services/console-email.sender.js';
import { DisabledEmailSender } from '../common/services/disabled-email.sender.js';

/**
 * 全局认证模块：AuthService 被 AuthGuard 在各业务模块中广泛依赖，
 * 声明为全局以避免每个模块重复导入 AuthModule。
 *
 * EMAIL_SENDER 选择策略（P1.6）：
 * - development / test：ConsoleEmailSender（token 打印到日志，方便本地开发）
 * - 其它（含 staging / production）：DisabledEmailSender（fail-closed）
 *
 * 生产环境接入真实 SMTP/SendGrid/SES 后替换此 provider。
 */
const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

@Global()
@Module({
  imports: [],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    TurnstileService,
    {
      provide: 'EMAIL_SENDER',
      useClass: isDev ? ConsoleEmailSender : DisabledEmailSender,
    },
  ],
  exports: [AuthService, PasswordService, SessionService, TurnstileService],
})
export class AuthModule {}
