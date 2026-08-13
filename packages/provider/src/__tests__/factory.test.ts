import { describe, it, expect } from 'vitest';
import { createObjectStorage } from '../storage/factory.js';

describe('createObjectStorage', () => {
  it('creates NoneObjectStorage for kind=none', () => {
    const storage = createObjectStorage({ kind: 'none' });
    expect(storage.provider).toBe('none');
  });

  it('creates S3ObjectStorage for kind=s3', () => {
    const storage = createObjectStorage({
      kind: 's3',
      s3: {
        region: 'us-east-1',
        bucket: 'test',
        prefix: 'enova',
        publicBaseUrl: '',
        endpointUrl: '',
        accessKey: 'ak',
        secretKey: 'sk',
      },
    });
    expect(storage.provider).toBe('s3');
  });

  it('throws for unsupported provider (e.g. legacy qiniu)', () => {
    expect(() =>
      createObjectStorage({ kind: 'qiniu' as any }),
    ).toThrow(/Unsupported storage provider "qiniu"/);
  });

  it('throws for unknown provider with clear message', () => {
    expect(() =>
      createObjectStorage({ kind: 'unknown' as any }),
    ).toThrow(/Unsupported storage provider "unknown"/);
  });
});