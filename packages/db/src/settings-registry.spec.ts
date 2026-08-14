import { describe, expect, it } from 'vitest';
import { SETTINGS_BY_KEY } from './settings-registry.js';

describe('runtime settings registry', () => {
  it('registers the canonical billing, storage, and logging settings', () => {
    expect(SETTINGS_BY_KEY.get('billing.welcomeCredits')?.envDefault).toBe('100');
    expect(SETTINGS_BY_KEY.get('storage.provider')).toMatchObject({
      options: ['aws_s3', 'qiniu', 'none'],
      envKey: 'STORAGE_PROVIDER',
      envDefault: 'aws_s3',
    });
    expect(SETTINGS_BY_KEY.get('storage.awsRegion')).toMatchObject({
      envKey: 'AWS_REGION',
      envDefault: 'ap-southeast-1',
    });
    expect(SETTINGS_BY_KEY.get('storage.qiniuRegion')).toMatchObject({
      envKey: 'QINIU_REGION',
      envDefault: 'z0',
    });
    expect(SETTINGS_BY_KEY.get('log.level')?.options).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]);
    expect(SETTINGS_BY_KEY.get('log.prompts')?.envDefault).toBe('false');
    expect(SETTINGS_BY_KEY.get('log.accessLog')?.envDefault).toBe('true');
  });

  it('registers dynamic email, support, branding, and rate-limit settings', () => {
    expect(SETTINGS_BY_KEY.get('email.smtpHost')).toMatchObject({
      envKey: 'SMTP_HOST',
      group: 'email',
    });
    expect(SETTINGS_BY_KEY.get('email.smtpPassword')).toMatchObject({
      envKey: 'SMTP_PASSWORD',
      isSecret: true,
    });
    expect(SETTINGS_BY_KEY.get('email.smtpPort')).toMatchObject({
      envKey: 'SMTP_PORT',
      envDefault: '587',
    });
    expect(SETTINGS_BY_KEY.get('general.supportEmail')?.envKey).toBe('SUPPORT_EMAIL');
    expect(SETTINGS_BY_KEY.get('general.appName')).toMatchObject({
      envKey: 'APP_NAME',
      envDefault: 'EnovaMotion',
    });
    expect(SETTINGS_BY_KEY.get('security.rateLimitEnabled')).toMatchObject({
      envKey: 'RATE_LIMIT_ENABLED',
      envDefault: 'true',
      permission: 'settings.security_write',
    });
    expect(SETTINGS_BY_KEY.get('security.rateLimitPrefix')?.envKey).toBe('RATE_LIMIT_PREFIX');
  });
});
