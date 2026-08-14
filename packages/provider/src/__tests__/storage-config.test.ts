import { describe, expect, it } from 'vitest';
import { resolveStorageConfig } from '../storage/config.js';

const env = {
  STORAGE_PROVIDER: 'none',
  AWS_REGION: '',
  AWS_S3_BUCKET: '',
  AWS_S3_PREFIX: '',
  AWS_S3_PUBLIC_BASE_URL: '',
  AWS_S3_ENDPOINT_URL: '',
  AWS_ACCESS_KEY_ID: '',
  AWS_SECRET_ACCESS_KEY: '',
  AWS_SESSION_TOKEN: '',
  QINIU_ACCESS_KEY: '',
  QINIU_SECRET_KEY: '',
  QINIU_BUCKET: '',
  QINIU_DOMAIN: '',
  QINIU_REGION: '',
};

describe('resolveStorageConfig', () => {
  it('uses settings values before env values and defaults', async () => {
    const values: Record<string, string | null> = {
      'storage.provider': 'aws_s3',
      'storage.awsRegion': 'eu-west-1',
      'storage.awsS3Bucket': 'db-bucket',
      'storage.awsS3Prefix': null,
      'storage.awsAccessKeyId': 'db-ak',
      'storage.awsSecretAccessKey': 'db-sk',
      'storage.awsSessionToken': 'db-token',
    };
    const reader = {
      getString: async (key: string) => values[key] ?? null,
      getSecret: async (key: string) => values[key] ?? null,
    };

    const result = await resolveStorageConfig(reader, {
      ...env,
      AWS_REGION: 'env-region',
      AWS_S3_BUCKET: 'env-bucket',
      AWS_S3_PREFIX: 'env-prefix',
    });

    expect(result).toMatchObject({
      provider: 'aws_s3',
      region: 'eu-west-1',
      bucket: 'db-bucket',
      prefix: 'env-prefix',
      credentials: { accessKeyId: 'db-ak', secretAccessKey: 'db-sk', sessionToken: 'db-token' },
      configured: true,
    });
  });

  it('keeps the process runnable and marks an incomplete provider unconfigured', async () => {
    const reader = {
      getString: async (key: string) => (key === 'storage.provider' ? 'aws_s3' : null),
      getSecret: async () => null,
    };

    const result = await resolveStorageConfig(reader, env);

    expect(result.provider).toBe('aws_s3');
    expect(result.configured).toBe(false);
  });
});
