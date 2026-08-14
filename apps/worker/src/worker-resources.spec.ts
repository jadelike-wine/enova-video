/**
 * WorkerResources 行为测试：并发 rebuild、失败保留旧资源、失败后恢复。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerResources } from './worker-resources.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockSettings(overrides: Record<string, any> = {}) {
  return {
    getStorageConfig: vi.fn().mockResolvedValue({
      provider: 'none',
      guard: { allowHttp: true, resolveDns: false, devAllowlist: [] },
      maxBytes: 1000,
      downloadTimeoutMs: 1000,
      allowedContentTypePrefixes: ['image/', 'video/'],
      s3Region: '',
      s3Bucket: '',
      s3Prefix: 'enova',
      s3PublicBaseUrl: '',
      s3EndpointUrl: '',
      s3AccessKey: null,
      s3SecretKey: null,
      ...overrides,
    }),
    getNumber: vi.fn(async (key: string) => {
      if (key === 'provider.httpTimeoutMs') return 120000;
      if (key === 'credential.leaseTtlMs') return 120000;
      return null;
    }),
    getString: vi.fn(async () => null),
    ...overrides,
  };
}

function createMockDeps(overrides: Record<string, any> = {}) {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: async () => [],
          })),
        })),
      })),
    } as any,
    redis: {
      duplicate: vi.fn(() => ({})),
    } as any,
    crypto: {
      encrypt: (s: string) => s,
      decrypt: (s: string) => s,
    } as any,
    settings: createMockSettings(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    } as any,
    env: {
      STORAGE_PROVIDER: 'none',
      STORAGE_MAX_BYTES: 536870912,
      STORAGE_DOWNLOAD_TIMEOUT_MS: 120000,
      STORAGE_ALLOWED_CONTENT_TYPES: 'image/,video/',
      SSRF_ALLOW_HTTP: 'false',
      SSRF_DEV_ALLOW_LIST: '',
      SSRF_RESOLVE_DNS: 'true',
      PROVIDER_HTTP_TIMEOUT_MS: 120000,
      CREDENTIAL_LEASE_TTL_MS: 120000,
      NODE_ENV: 'development',
      AWS_REGION: 'ap-southeast-1',
      AWS_S3_BUCKET: '',
      AWS_S3_PREFIX: 'agnes-ai',
      AWS_S3_PUBLIC_BASE_URL: '',
      AWS_S3_ENDPOINT_URL: '',
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkerResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('initializes holder after init()', async () => {
      const deps = createMockDeps();
      const resources = new WorkerResources(deps as any);
      await resources.init();
      expect(() => resources.storage).not.toThrow();
      expect(() => resources.registry).not.toThrow();
      expect(() => resources.credentials).not.toThrow();
      expect(() => resources.storageConfig).not.toThrow();
    });

    it('throws if getter called before init()', () => {
      const deps = createMockDeps();
      const resources = new WorkerResources(deps as any);
      expect(() => resources.storage).toThrow('WorkerResources not initialized');
    });
  });

  describe('serial rebuild (concurrency protection)', () => {
    it('only allows one rebuild at a time', async () => {
      const deps = createMockDeps();
      let resolveFirst: () => void;
      let firstBuildStarted = false;
      let secondBuildStarted = false;

      // Make getStorageConfig block on first call
      const origGetStorageConfig = deps.settings.getStorageConfig;
      deps.settings.getStorageConfig = vi.fn().mockImplementation(async () => {
        if (!firstBuildStarted) {
          firstBuildStarted = true;
          return new Promise<any>((resolve) => {
            resolveFirst = () => resolve(origGetStorageConfig());
          });
        }
        secondBuildStarted = true;
        return origGetStorageConfig();
      });

      const resources = new WorkerResources(deps as any);

      // Start first rebuild (will block)
      const rebuild1 = resources.rebuild(['storage.s3Bucket']);
      await vi.waitFor(() => expect(firstBuildStarted).toBe(true), { timeout: 100 });

      // Start second rebuild while first is still in progress
      const rebuild2 = resources.rebuild(['storage.s3AccessKey']);

      // Second rebuild should not have started yet
      expect(secondBuildStarted).toBe(false);

      // Resolve first rebuild
      resolveFirst!();
      await rebuild1;

      // Wait for second rebuild to complete
      await rebuild2;

      expect(secondBuildStarted).toBe(true);
    });
  });

  describe('invalidation coalescing (dirty flag)', () => {
    it('merges pending keys during concurrent rebuilds', async () => {
      const deps = createMockDeps();
      const rebuildLog: string[] = [];
      let resolveFirst: (() => void) | null = null;

      deps.settings.getStorageConfig = vi.fn().mockImplementation(async () => {
        rebuildLog.push('rebuild');
        return new Promise<any>((resolve) => {
          if (!resolveFirst) {
            resolveFirst = () => resolve({
              provider: 'none',
              guard: { allowHttp: true, resolveDns: false, devAllowlist: [] },
              maxBytes: 1000,
              downloadTimeoutMs: 1000,
              allowedContentTypePrefixes: ['image/', 'video/'],
              s3Region: '', s3Bucket: '', s3Prefix: 'enova',
              s3PublicBaseUrl: '', s3EndpointUrl: '',
              s3AccessKey: null, s3SecretKey: null,
            });
          } else {
            // Subsequent calls resolve immediately (coalesced rebuild)
            resolve({
              provider: 'none',
              guard: { allowHttp: true, resolveDns: false, devAllowlist: [] },
              maxBytes: 1000,
              downloadTimeoutMs: 1000,
              allowedContentTypePrefixes: ['image/', 'video/'],
              s3Region: '', s3Bucket: '', s3Prefix: 'enova',
              s3PublicBaseUrl: '', s3EndpointUrl: '',
              s3AccessKey: null, s3SecretKey: null,
            });
          }
        });
      });

      const resources = new WorkerResources(deps as any);

      // Start first rebuild (will block)
      const rebuild1 = resources.rebuild(['storage.s3Bucket']);
      await vi.waitFor(() => expect(rebuildLog).toHaveLength(1), { timeout: 100 });

      // Send two more invalidations while first is in progress
      const rebuild2 = resources.rebuild(['storage.s3AccessKey']);
      const rebuild3 = resources.rebuild(['provider.httpTimeoutMs']);

      // Resolve first rebuild
      resolveFirst!();
      await rebuild1;
      await rebuild2;
      await rebuild3;

      // Should have done at least 2 rebuilds (first + coalesced second)
      expect(rebuildLog.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('failure preserves old resource', () => {
    it('keeps old resource when rebuild throws', async () => {
      const deps = createMockDeps();
      let callCount = 0;

      deps.settings.getStorageConfig = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First rebuild succeeds
          return {
            provider: 'none',
            guard: { allowHttp: true, resolveDns: false, devAllowlist: [] },
            maxBytes: 1000,
            downloadTimeoutMs: 1000,
            allowedContentTypePrefixes: ['image/', 'video/'],
            s3Region: '', s3Bucket: '', s3Prefix: 'enova',
            s3PublicBaseUrl: '', s3EndpointUrl: '',
            s3AccessKey: null, s3SecretKey: null,
          };
        }
        // Second rebuild fails
        throw new Error('rebuild failed');
      });

      const resources = new WorkerResources(deps as any);

      // First init succeeds
      await resources.init();
      const firstStorage = resources.storage;

      // Second rebuild fails
      await resources.rebuild(['storage.s3Bucket']);

      // Should still hold the old resource (not undefined/null)
      expect(resources.storage).toBe(firstStorage);
      expect(() => resources.storage).not.toThrow();
    });

    it('error log does not contain secrets', async () => {
      const deps = createMockDeps();
      // First call succeeds
      deps.settings.getStorageConfig = vi.fn()
        .mockResolvedValueOnce({
          provider: 'none',
          guard: { allowHttp: true, resolveDns: false, devAllowlist: [] },
          maxBytes: 1000, downloadTimeoutMs: 1000,
          allowedContentTypePrefixes: ['image/', 'video/'],
          s3Region: '', s3Bucket: '', s3Prefix: 'enova',
          s3PublicBaseUrl: '', s3EndpointUrl: '',
          s3AccessKey: null, s3SecretKey: null,
        })
        .mockRejectedValueOnce(new Error('secret-key-12345'));

      const resources = new WorkerResources(deps as any);
      await resources.init();

      await resources.rebuild(['storage.s3Bucket']);

      // Error should have been logged
      expect(deps.logger.error).toHaveBeenCalled();
      const errorCallArgs = (deps.logger.error as any).mock.calls[0];
      // The error message should NOT contain the full error string
      const errorMessage = JSON.stringify(errorCallArgs);
      expect(errorMessage).not.toContain('secret-key-12345');
    });
  });

  describe('recovery after failure', () => {
    it('can rebuild successfully after a previous failure', async () => {
      const deps = createMockDeps();
      let callCount = 0;

      deps.settings.getStorageConfig = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            provider: 'none',
            guard: { allowHttp: true, resolveDns: false, devAllowlist: [] },
            maxBytes: 1000, downloadTimeoutMs: 1000,
            allowedContentTypePrefixes: ['image/', 'video/'],
            s3Region: '', s3Bucket: '', s3Prefix: 'enova',
            s3PublicBaseUrl: '', s3EndpointUrl: '',
            s3AccessKey: null, s3SecretKey: null,
          };
        }
        if (callCount === 2) {
          throw new Error('rebuild failed');
        }
        return {
          provider: 's3',
          guard: { allowHttp: true, resolveDns: false, devAllowlist: [] },
          maxBytes: 2000, downloadTimeoutMs: 2000,
          allowedContentTypePrefixes: ['image/', 'video/'],
          s3Region: 'us-east-1', s3Bucket: 'test-bucket', s3Prefix: 'enova',
          s3PublicBaseUrl: 'https://cdn.test', s3EndpointUrl: '',
          s3AccessKey: 'ak', s3SecretKey: 'sk',
        };
      });

      const resources = new WorkerResources(deps as any);

      // Init succeeds
      await resources.init();
      expect(callCount).toBe(1);

      // First rebuild fails
      await resources.rebuild(['storage.s3Bucket']);
      expect(callCount).toBe(2);

      // Second rebuild succeeds
      await resources.rebuild(['storage.s3Bucket']);
      expect(callCount).toBe(3);

      // Should not be stuck
      expect(() => resources.storage).not.toThrow();
    });
  });
});
