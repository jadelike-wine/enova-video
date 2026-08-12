import { Injectable, Logger } from '@nestjs/common';
import type { EmailSender } from './email-sender.interface.js';

/**
 * Development email sender: logs tokens to console.
 *
 * WARNING: Do NOT use in production. Tokens are logged in plaintext.
 * Production must configure a real EmailSender adapter (SMTP/SendGrid/SES).
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender');

  async sendPasswordReset(opts: { email: string; resetToken: string }): Promise<void> {
    this.logger.warn(
      `[DEV] Password reset for ${opts.email}: token=${opts.resetToken}\n` +
      'Configure a real EmailSender for production.',
    );
  }

  async sendEmailVerification(opts: { email: string; verifyToken: string }): Promise<void> {
    this.logger.warn(
      `[DEV] Email verification for ${opts.email}: token=${opts.verifyToken}\n` +
      'Configure a real EmailSender for production.',
    );
  }
}
