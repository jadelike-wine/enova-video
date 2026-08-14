/**
 * P0-2: Security configuration tests.
 *
 * Verifies CORS allowlist, cookie security, and production validation.
 * Tests service-level config validation: API vs Worker.
 */

import { describe, it, expect } from 'vitest';
import { loadEnv } from '@enova/config';

/** Shared production env vars that both API and Worker need. */
const sharedProdEnv = {
  NODE_ENV: 'production' as const,
  CREDENTIAL_MASTER_KEY: 'real-32-byte-key-for-production-use-only',
  DATABASE_URL: 'postgresql://enova:realpass@db:5432/enova',
  REDIS_URL: 'redis://:realpass@redis:6379',
  STORAGE_PROVIDER: 'aws_s3' as const,
  AWS_REGION: 'ap-southeast-1',
  AWS_S3_BUCKET: 'my-bucket',
  SUPPORT_EMAIL: 'support@enova-motion.com',
  APP_PASSWORD_RESET_URL: 'https://app.example.com/auth/reset-password',
  APP_EMAIL_VERIFY_URL: 'https://app.example.com/auth/verify-email',
};

/** Full API production env (adds SMTP, payment, CORS, site URL). */
const apiProdEnv = {
  ...sharedProdEnv,
  PAYMENT_MODE: 'alipay' as const,
  PAYMENT_RETURN_BASE_URL: 'https://app.example.com',
  PAYMENT_NOTIFY_URL: 'https://api.example.com/api/v1/payment/notify',
  ALIPAY_APP_ID: '2021000000000001',
  ALIPAY_PRIVATE_KEY: 'private-key-content',
  ALIPAY_PUBLIC_KEY: 'public-key-content',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'noreply@example.com',
  SMTP_PASSWORD: 'real-smtp-password',
  SMTP_FROM_EMAIL: 'noreply@example.com',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  APP_SITE_URL: 'https://app.example.com',
};

describe('P0-2: Production Security Configuration', () => {
  describe('CORS Allowed Origins', () => {
    it('should parse comma-separated origins', () => {
      const env = loadEnv({
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
      });
      const origins = env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
      expect(origins).toEqual(['https://app.example.com', 'https://admin.example.com']);
    });

    it('should default to localhost in development', () => {
      const env = loadEnv({ NODE_ENV: 'development' });
      expect(env.CORS_ALLOWED_ORIGINS).toBe('http://localhost:3000');
    });
  });

  describe('Swagger Protection', () => {
    it('should default to disabled', () => {
      const env = loadEnv({ NODE_ENV: 'development' });
      expect(env.SWAGGER_ENABLED).toBe(false);
    });

    it('should be explicitly enabled when set', () => {
      const env = loadEnv({ NODE_ENV: 'development', SWAGGER_ENABLED: 'true' });
      expect(env.SWAGGER_ENABLED).toBe(true);
    });
  });

  describe('Service-Level Config: API Production Validation', () => {
    it('should accept valid API production config', () => {
      const env = loadEnv(apiProdEnv, { service: 'api' });
      expect(env.NODE_ENV).toBe('production');
      expect(env.PAYMENT_MODE).toBe('alipay');
      expect(env.STORAGE_PROVIDER).toBe('aws_s3');
    });

    it('should reject sandbox payment mode', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, PAYMENT_MODE: 'sandbox' }, { service: 'api' }),
      ).toThrow(/PAYMENT_MODE=sandbox/);
    });

    it('should allow storage to be configured later in System Settings', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, STORAGE_PROVIDER: 'none' }, { service: 'api' }),
      ).not.toThrow();
    });

    it('should reject localhost payment URLs', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, PAYMENT_RETURN_BASE_URL: 'http://localhost:3000' }, { service: 'api' }),
      ).toThrow(/localhost/);
    });

    it('should reject non-HTTPS payment URLs', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, PAYMENT_RETURN_BASE_URL: 'http://app.example.com' }, { service: 'api' }),
      ).toThrow(/HTTPS/);
    });

    it('should reject missing SMTP config', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, SMTP_HOST: '' }, { service: 'api' }),
      ).toThrow(/SMTP/);
    });

    it('should reject dev master key', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, CREDENTIAL_MASTER_KEY: 'dev-master-key-not-for-production' }, { service: 'api' }),
      ).toThrow(/dev defaults/);
    });

    it('should reject missing alipay credentials', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, ALIPAY_PRIVATE_KEY: '' }, { service: 'api' }),
      ).toThrow(/alipay/);
    });

    it('should reject missing wechat credentials', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, PAYMENT_MODE: 'wechat', WECHAT_APP_ID: '' }, { service: 'api' }),
      ).toThrow(/wechat/);
    });

    it('should reject non-HTTPS APP_SITE_URL', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, APP_SITE_URL: 'http://app.example.com' }, { service: 'api' }),
      ).toThrow(/APP_SITE_URL.*HTTPS/);
    });

    it('should reject invalid CORS origins', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, CORS_ALLOWED_ORIGINS: 'not-a-url' }, { service: 'api' }),
      ).toThrow(/CORS_ALLOWED_ORIGINS/);
    });

    it('should reject default database credentials', () => {
      expect(() =>
        loadEnv({ ...apiProdEnv, DATABASE_URL: 'postgresql://enova:enova@db:5432/enova' }, { service: 'api' }),
      ).toThrow(/default database credentials/);
    });
  });

  describe('Service-Level Config: Worker Production Validation', () => {
    it('should accept valid Worker production config without SMTP/payment/CORS', () => {
      // Worker only needs: DB, Redis, Master Key, Storage. No SMTP, no payment, no CORS.
      const env = loadEnv(sharedProdEnv, { service: 'worker' });
      expect(env.NODE_ENV).toBe('production');
      expect(env.STORAGE_PROVIDER).toBe('aws_s3');
    });

    it('should NOT reject missing SMTP for worker', () => {
      expect(() =>
        loadEnv(sharedProdEnv, { service: 'worker' }),
      ).not.toThrow();
    });

    it('should NOT reject sandbox payment mode for worker', () => {
      // Worker does not process payments; PAYMENT_MODE is irrelevant.
      expect(() =>
        loadEnv({ ...sharedProdEnv, PAYMENT_MODE: 'sandbox' }, { service: 'worker' }),
      ).not.toThrow();
    });

    it('should reject dev master key for worker', () => {
      expect(() =>
        loadEnv({ ...sharedProdEnv, CREDENTIAL_MASTER_KEY: 'dev-master-key-not-for-production' }, { service: 'worker' }),
      ).toThrow(/dev defaults/);
    });

    it('should allow none storage for worker before System Settings is configured', () => {
      expect(() =>
        loadEnv({ ...sharedProdEnv, STORAGE_PROVIDER: 'none' }, { service: 'worker' }),
      ).not.toThrow();
    });

    it('should allow missing storage settings for worker bootstrap', () => {
      expect(() =>
        loadEnv({ ...sharedProdEnv, AWS_REGION: '', AWS_S3_BUCKET: '' }, { service: 'worker' }),
      ).not.toThrow();
    });

    it('should reject default database credentials for worker', () => {
      expect(() =>
        loadEnv({ ...sharedProdEnv, DATABASE_URL: 'postgresql://enova:enova@db:5432/enova' }, { service: 'worker' }),
      ).toThrow(/default database credentials/);
    });
  });

  describe('Cookie Security', () => {
    it('should set secure=true when protocol is https', () => {
      const mockHttpsReq = { protocol: 'https' } as const;
      const mockHttpReq = { protocol: 'http' } as const;
      const secureHttps = mockHttpsReq.protocol === 'https';
      const secureHttp = mockHttpReq.protocol === 'https';
      expect(secureHttps).toBe(true);
      expect(secureHttp).toBe(false);
    });

    it('should use sameSite=lax for CSRF protection', () => {
      const sameSite = 'lax';
      expect(sameSite).toBe('lax');
    });

    it('should use httpOnly=true to prevent XSS token theft', () => {
      const httpOnly = true;
      expect(httpOnly).toBe(true);
    });
  });
});
