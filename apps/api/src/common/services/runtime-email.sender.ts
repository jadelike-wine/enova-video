import { ConsoleEmailSender } from './console-email.sender.js';
import { DisabledEmailSender } from './disabled-email.sender.js';
import { SmtpEmailSender, type SmtpEmailOptions } from './smtp-email.sender.js';
import type { EmailSender } from './email-sender.interface.js';

export interface RuntimeEmailSettings {
  getMany(keys: string[]): Promise<Map<string, string | null>>;
}

export interface RuntimeEmailEnvironment {
  NODE_ENV: string;
}

type SmtpSender = EmailSender & { sendTestEmail(to: string): Promise<void> };
type SmtpFactory = (options: SmtpEmailOptions) => SmtpSender;

const EMAIL_SETTING_KEYS = [
  'email.smtpHost',
  'email.smtpPort',
  'email.smtpSecure',
  'email.smtpUser',
  'email.smtpPassword',
  'email.smtpFromName',
  'email.smtpFromEmail',
  'email.passwordResetUrl',
  'email.emailVerifyUrl',
  'general.appName',
];

/**
 * Runtime email adapter.
 *
 * The existing email sender was constructed once from ENV. This delegating
 * adapter reads the registered settings before each email operation, so a DB
 * update takes effect immediately while preserving Console/Disabled behavior.
 */
export class RuntimeEmailSender implements EmailSender {
  private delegate: EmailSender | null = null;
  private delegateSignature: string | null = null;

  constructor(
    private readonly settings: RuntimeEmailSettings,
    private readonly env: RuntimeEmailEnvironment,
    private readonly createSmtp: SmtpFactory = (options) => new SmtpEmailSender(options),
  ) {}

  async sendPasswordReset(opts: { email: string; resetToken: string }): Promise<void> {
    const sender = await this.currentSender();
    await sender.sendPasswordReset(opts);
  }

  async sendEmailVerification(opts: { email: string; verifyToken: string }): Promise<void> {
    const sender = await this.currentSender();
    await sender.sendEmailVerification(opts);
  }

  async isSmtpConfigured(): Promise<boolean> {
    const sender = await this.currentSender();
    return this.isSmtpSender(sender);
  }

  async sendTestEmail(to: string): Promise<void> {
    const sender = await this.currentSender();
    if (!this.isSmtpSender(sender)) {
      throw new Error('SMTP email sender is not configured');
    }
    await sender.sendTestEmail(to);
  }

  private async currentSender(): Promise<EmailSender> {
    const values = await this.settings.getMany(EMAIL_SETTING_KEYS);
    if (this.env.NODE_ENV === 'development' || this.env.NODE_ENV === 'test') {
      if (this.delegateSignature !== 'console') {
        this.delegate = new ConsoleEmailSender();
        this.delegateSignature = 'console';
      }
      return this.delegate!;
    }

    const options = this.smtpOptions(values);
    if (!options) {
      if (this.delegateSignature !== 'disabled') {
        this.delegate = new DisabledEmailSender();
        this.delegateSignature = 'disabled';
      }
      return this.delegate!;
    }

    const signature = JSON.stringify(options);
    if (this.delegateSignature !== signature) {
      this.delegate = this.createSmtp(options);
      this.delegateSignature = signature;
    }
    return this.delegate!;
  }

  private smtpOptions(values: Map<string, string | null>): SmtpEmailOptions | null {
    const get = (key: string, fallback = '') => values.get(key) ?? fallback;
    const host = get('email.smtpHost').trim();
    const user = get('email.smtpUser').trim();
    const password = get('email.smtpPassword');
    const fromEmail = get('email.smtpFromEmail').trim();
    if (!host || !user || !password || !fromEmail) return null;

    const port = Number(get('email.smtpPort', '587'));
    return {
      host,
      port: Number.isFinite(port) ? port : 587,
      secure: ['1', 'true', 'yes', 'on'].includes(get('email.smtpSecure', 'false').toLowerCase()),
      user,
      password,
      fromName: get('email.smtpFromName', 'EnovaMotion'),
      fromEmail,
      resetUrl: get('email.passwordResetUrl', 'http://localhost:3000/auth/reset-password'),
      verifyUrl: get('email.emailVerifyUrl', 'http://localhost:3000/auth/verify-email'),
      appName: get('general.appName', 'EnovaMotion'),
    };
  }

  private isSmtpSender(sender: EmailSender): sender is SmtpSender {
    return typeof (sender as Partial<SmtpSender>).sendTestEmail === 'function';
  }
}
