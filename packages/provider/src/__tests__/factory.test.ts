import { describe, it, expect } from 'vitest';
import { createObjectStorage } from '../storage/factory.js';

describe('createObjectStorage', () => {
  it('creates NoneObjectStorage for kind=none', () => {
    const storage = createObjectStorage({ kind: 'none' });
    expect(storage.provider).toBe('none');
  });

  it('creates AWS S3 storage for canonical kind=aws_s3', () => {
    const storage = createObjectStorage({
      kind: 'aws_s3',
      s3: {
        region: 'us-east-1',
        bucket: 'test',
        prefix: 'enova',
        publicBaseUrl: '',
        endpointUrl: '',
        credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
      },
    });
    expect(storage.provider).toBe('aws_s3');
  });

  it('creates Qiniu storage for kind=qiniu', () => {
    const storage = createObjectStorage({
      kind: 'qiniu',
      qiniu: {
        accessKey: 'ak',
        secretKey: 'sk',
        bucket: 'bucket',
        domain: 'https://cdn.example.com',
        region: 'z0',
        prefix: 'enova',
        download: { guard: { allowHttp: false, resolveDns: false, devAllowlist: [] }, maxBytes: 1, timeoutMs: 1 },
        allowedContentTypePrefixes: ['image/'],
      },
    });
    expect(storage.provider).toBe('qiniu');
  });

  it('throws for unknown provider with clear message', () => {
    expect(() =>
      createObjectStorage({ kind: 'unknown' as any }),
    ).toThrow(/Unsupported storage provider "unknown"/);
  });
});
