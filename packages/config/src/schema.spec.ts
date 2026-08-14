import { describe, expect, it } from 'vitest';
import { loadEnv } from './schema.js';

describe('loadEnv canonical runtime settings', () => {
  it('normalizes legacy s3 names into canonical aws_s3 settings', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      STORAGE_PROVIDER: 's3',
      S3_REGION: 'legacy-region',
      S3_BUCKET: 'legacy-bucket',
      S3_PREFIX: 'legacy-prefix',
      S3_PUBLIC_BASE_URL: 'https://legacy.example.com',
      S3_ENDPOINT_URL: 'https://s3.example.com',
      S3_ACCESS_KEY: 'legacy-access',
      S3_SECRET_KEY: 'legacy-secret',
    });

    expect(env.STORAGE_PROVIDER).toBe('aws_s3');
    expect(env.AWS_REGION).toBe('legacy-region');
    expect(env.AWS_S3_BUCKET).toBe('legacy-bucket');
    expect(env.AWS_S3_PREFIX).toBe('legacy-prefix');
    expect(env.AWS_ACCESS_KEY_ID).toBe('legacy-access');
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('legacy-secret');
  });

  it('keeps canonical values when both canonical and legacy names exist', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      STORAGE_PROVIDER: 'aws_s3',
      AWS_REGION: 'canonical-region',
      S3_REGION: 'legacy-region',
    });

    expect(env.STORAGE_PROVIDER).toBe('aws_s3');
    expect(env.AWS_REGION).toBe('canonical-region');
  });

  it('uses aws_s3 and requested runtime defaults when storage/log env is absent', () => {
    const env = loadEnv({ NODE_ENV: 'test' });

    expect(env.STORAGE_PROVIDER).toBe('aws_s3');
    expect(env.AWS_REGION).toBe('ap-southeast-1');
    expect(env.AWS_S3_PREFIX).toBe('agnes-ai');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.LOG_FORMAT).toBe('text');
    expect(env.LOG_PROMPTS).toBe(false);
    expect(env.ACCESS_LOG).toBe(true);
  });

  it('allows production to bootstrap before DB-managed email and payment settings exist', () => {
    expect(() =>
      loadEnv(
        {
          NODE_ENV: 'production',
          CREDENTIAL_MASTER_KEY: 'real-32-byte-key-for-production-use-only',
          DATABASE_URL: 'postgresql://enova:realpass@db:5432/enova',
          REDIS_URL: 'redis://:realpass@redis:6379',
          CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        },
        { service: 'api' },
      ),
    ).not.toThrow();
  });
});
