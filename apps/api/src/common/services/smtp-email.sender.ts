import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailSender } from './email-sender.interface.js';
import {
  renderPasswordResetEmail,
  renderEmailVerificationEmail,
  renderTestEmail,
} from './email-templates.js';

/**
 * SMTP email sender (P0-1).
 *
 * Production-ready email sender using nodemailer with SMTP transport.
 * Supports SMTP and SMTP-over-TLS (secure: true).
 *
 * Configuration via environment variables:
 * - SMTP_HOST: SMTP server host
 * - SMTP_PORT: SMTP server port (default 587)
 * - SMTP_SECURE: true for 465 (TLS), false for 587 (STARTTLS)
 * - SMTP_USER: SMTP auth username
 * - SMTP_PASSWORD: SMTP auth password
 * - SMTP_FROM_NAME: From display name
 * - SMTP_FROM_EMAIL: From email address
 * - APP_PASSWORD_RESET_URL: Frontend URL for password reset
 * - APP_EMAIL_VERIFY_URL: Frontend URL for email verification
 * - SITE_NAME: Site name for email branding
 *
 * Security:
 * - SMTP credentials are NEVER logged.
 * - Email tokens are NEVER logged (only in ConsoleEmailSender for dev).
 * - Send failures produce structured error logs without leaking credentials.
 */
export interface SmtpEmailOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  resetUrl: string;
  verifyUrl: string;
  siteName: string;
}

@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger('SmtpEmailSender');
  private readonly transporter: Transporter;
  private readonly fromName: string;
  private readonly fromEmail: string;
  private readonly resetUrl: string;
  private readonly verifyUrl: string;
  private readonly siteName: string;

  constructor(opts: SmtpEmailOptions) {
    this.transporter = createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: {
        user: opts.user,
        pass: opts.password,
      },
    });
    this.fromName = opts.fromName;
    this.fromEmail = opts.fromEmail;
    this.resetUrl = opts.resetUrl;
    this.verifyUrl = opts.verifyUrl;
    this.siteName = opts.siteName;
  }

  async sendPasswordReset(opts: { email: string; resetToken: string }): Promise<void> {
    const tpl = renderPasswordResetEmail({
      email: opts.email,
      resetToken: opts.resetToken,
      resetUrl: this.resetUrl,
      siteName: this.siteName,
    });
    await this.send(opts.email, tpl);
  }

  async sendEmailVerification(opts: { email: string; verifyToken: string }): Promise<void> {
    const tpl = renderEmailVerificationEmail({
      email: opts.email,
      verifyToken: opts.verifyToken,
      verifyUrl: this.verifyUrl,
      siteName: this.siteName,
    });
    await this.send(opts.email, tpl);
  }

  /** Admin test email (used by admin endpoint to verify SMTP config). */
  async sendTestEmail(to: string): Promise<void> {
    const tpl = renderTestEmail({ siteName: this.siteName });
    await this.send(to, tpl);
  }

  private async send(to: string, tpl: { subject: string; html: string; text: string }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    } catch (err) {
      // Structured error log WITHOUT leaking SMTP credentials or email tokens.
      this.logger.error(
        `Failed to send email to ${this.maskEmail(to)}: ${this.extractErrorMessage(err)}`,
        undefined,
        'EMAIL_SEND_FAILED',
      );
      throw err;
    }
  }

  /** Mask email for logging: u***@example.com */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    return `${local[0]}***@${domain}`;
  }

  /** Extract safe error message without credentials. */
  private extractErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      // Remove potential credential leaks from error messages
      return err.message.replace(/(password|pass|token|key|auth)[=:]\s*\S+/gi, '$1=***');
    }
    return 'Unknown error';
  }
}
