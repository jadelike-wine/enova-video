import { describe, expect, it, vi } from 'vitest';
import type { EmailSender } from './email-sender.interface.js';
import { RuntimeEmailSender, type RuntimeEmailSettings } from './runtime-email.sender.js';

const completeSettings = (overrides: Record<string, string> = {}) => new Map<string, string | null>([
  ['email.smtpHost', 'smtp.example.com'],
  ['email.smtpPort', '2525'],
  ['email.smtpSecure', 'true'],
  ['email.smtpUser', 'mailer'],
  ['email.smtpPassword', 'secret'],
  ['email.smtpFromName', 'Enova'],
  ['email.smtpFromEmail', 'noreply@example.com'],
  ['email.passwordResetUrl', 'https://app.example.com/reset'],
  ['email.emailVerifyUrl', 'https://app.example.com/verify'],
  ['general.appName', 'Enova Creator'],
  ...Object.entries(overrides),
]);

function fakeSender(): EmailSender & { sendTestEmail: ReturnType<typeof vi.fn> } {
  return {
    sendPasswordReset: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendTestEmail: vi.fn(),
  };
}

describe('RuntimeEmailSender', () => {
  it('rebuilds SMTP delivery from current settings without restarting the API', async () => {
    let values = completeSettings();
    const settings: RuntimeEmailSettings = {
      getMany: vi.fn(async () => values),
    };
    const senders: Array<ReturnType<typeof fakeSender>> = [];
    const sender = new RuntimeEmailSender(settings, { NODE_ENV: 'production' }, (opts) => {
      expect(opts.host).toBe(values.get('email.smtpHost'));
      expect(opts.port).toBe(Number(values.get('email.smtpPort')));
      expect(opts.appName).toBe(values.get('general.appName'));
      const created = fakeSender();
      senders.push(created);
      return created;
    });

    await sender.sendPasswordReset({ email: 'user@example.com', resetToken: 'token-1' });
    expect(senders).toHaveLength(1);
    expect(senders[0].sendPasswordReset).toHaveBeenCalledWith({ email: 'user@example.com', resetToken: 'token-1' });

    values = completeSettings({ 'email.smtpFromName': 'New Enova' });
    await sender.sendEmailVerification({ email: 'user@example.com', verifyToken: 'token-2' });
    expect(senders).toHaveLength(2);
    expect(senders[1].sendEmailVerification).toHaveBeenCalledWith({ email: 'user@example.com', verifyToken: 'token-2' });
  });

  it('fails closed when production SMTP settings are incomplete', async () => {
    const settings: RuntimeEmailSettings = {
      getMany: vi.fn(async () => completeSettings({ 'email.smtpPassword': '' })),
    };
    const sender = new RuntimeEmailSender(settings, { NODE_ENV: 'production' }, () => fakeSender());

    await expect(sender.isSmtpConfigured()).resolves.toBe(false);
  });

  it('builds email URLs from the configured site URL when dedicated URLs are absent', async () => {
    const settings: RuntimeEmailSettings = {
      getMany: vi.fn(async () => completeSettings({
        'email.passwordResetUrl': 'http://localhost:3000/zh-CN/auth/reset-password',
        'email.emailVerifyUrl': 'http://localhost:3000/zh-CN/auth/verify-email',
        'general.siteUrl': 'https://app.example.com///',
      })),
    };
    const createSmtp = vi.fn(() => fakeSender());
    const sender = new RuntimeEmailSender(settings, { NODE_ENV: 'production' }, createSmtp);

    await sender.isSmtpConfigured();

    expect(createSmtp).toHaveBeenCalledWith(expect.objectContaining({
      resetUrl: 'https://app.example.com/zh-CN/auth/reset-password',
      verifyUrl: 'https://app.example.com/zh-CN/auth/verify-email',
    }));
  });

  it('keeps development console behavior even when SMTP values exist', async () => {
    const settings: RuntimeEmailSettings = {
      getMany: vi.fn(async () => completeSettings()),
    };
    const createSmtp = vi.fn(() => fakeSender());
    const sender = new RuntimeEmailSender(settings, { NODE_ENV: 'development' }, createSmtp);

    await sender.sendPasswordReset({ email: 'user@example.com', resetToken: 'token' });

    expect(createSmtp).not.toHaveBeenCalled();
  });
});
