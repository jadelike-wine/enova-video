import { Injectable, Logger } from '@nestjs/common';
import type { EmailSender } from './email-sender.interface.js';

/**
 * Production fail-closed email sender (P1.6).
 *
 * 当未配置真实 SMTP/SendGrid/SES 适配器时，production 环境使用此实现。
 * 它不发送任何邮件，也不将 token 写入日志——fail-closed。
 * 调用方应告知用户"邮件服务暂未配置"。
 */
@Injectable()
export class DisabledEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender');

  async sendPasswordReset(opts: { email: string; resetToken: string }): Promise<void> {
    this.logger.warn(
      `Password reset requested for ${opts.email} but no EmailSender adapter is configured. ` +
      'The reset token was generated but NOT delivered. Configure a real EmailSender for production.',
    );
  }

  async sendEmailVerification(opts: { email: string; verifyToken: string }): Promise<void> {
    this.logger.warn(
      `Email verification requested for ${opts.email} but no EmailSender adapter is configured. ` +
      'The verification token was generated but NOT delivered. Configure a real EmailSender for production.',
    );
  }
}
