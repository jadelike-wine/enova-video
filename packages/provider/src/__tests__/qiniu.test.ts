import { afterEach, describe, expect, it, vi } from 'vitest';
import { QiniuObjectStorage } from '../storage/qiniu.js';

describe('QiniuObjectStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads bytes with a signed upload token and returns the public URL', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get('token')).toMatch(/^ak:/);
      expect(body.get('key')).toMatch(/^enova\/images\//);
      return new Response(JSON.stringify({ key: body.get('key') }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const storage = new QiniuObjectStorage({
      accessKey: 'ak',
      secretKey: 'sk',
      bucket: 'bucket',
      domain: 'https://cdn.example.com',
      region: 'z0',
      prefix: 'enova',
      download: { guard: { allowHttp: false, resolveDns: false, devAllowlist: [] }, maxBytes: 1024, timeoutMs: 1000 },
      allowedContentTypePrefixes: ['image/'],
    });

    const result = await storage.uploadBytes(Buffer.from('image'), {
      mediaType: 'image',
      ext: 'png',
      contentType: 'image/png',
    });

    expect(result?.provider).toBe('qiniu');
    expect(result?.url).toMatch(/^https:\/\/cdn\.example\.com\/enova\/images\//);
    expect(fetchMock).toHaveBeenCalledWith('https://upload.qiniup.com', expect.objectContaining({ method: 'POST' }));
  });
});
