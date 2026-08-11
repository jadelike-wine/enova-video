import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgnesProvider } from '../agnes/agnes.provider.js';
import { mapAgnesImageResponse, mapAgnesVideoStatus, mapAgnesVideoSubmission } from '../agnes/agnes.mapper.js';
import { ProviderError } from '../errors.js';
import type { AgnesImageResponse, AgnesVideoResponse } from '../agnes/agnes.types.js';

const GUARD = { allowHttp: true, resolveDns: false };
const BASE = 'https://agnes.example.com';

function makeProvider(): AgnesProvider {
  return new AgnesProvider({ baseUrl: BASE, timeoutMs: 5000, guard: GUARD });
}

describe('agnes mapper (constant-time normalization)', () => {
  it('maps image response with url', () => {
    const resp: AgnesImageResponse = { data: [{ url: 'https://x.test/img.png' }], duration_ms: 120 };
    const out = mapAgnesImageResponse(resp);
    expect(out.sourceUrl).toBe('https://x.test/img.png');
    expect(out.providerMetadata).toEqual({ durationMs: 120 });
  });

  it('maps image b64_json', () => {
    const resp: AgnesImageResponse = { data: [{ b64_json: 'iVBORw0=' }] };
    expect(mapAgnesImageResponse(resp).base64).toBe('iVBORw0=');
  });

  it('throws on image response missing data', () => {
    expect(() => mapAgnesImageResponse({})).toThrow(ProviderError);
  });

  it('throws on image item without url/b64', () => {
    expect(() => mapAgnesImageResponse({ data: [{}] })).toThrow(ProviderError);
  });

  it('maps video submit id', () => {
    const resp: AgnesVideoResponse = { task_id: 'task-1' };
    expect(mapAgnesVideoSubmission(resp).providerJobId).toBe('task-1');
  });

  it('extracts video_id fallback', () => {
    expect(mapAgnesVideoSubmission({ video_id: 'v-99' }).providerJobId).toBe('v-99');
  });

  it('maps video processing', () => {
    const s = mapAgnesVideoStatus({ status: 'in_progress', progress: 40 });
    expect(s).toMatchObject({ status: 'processing', progress: 40 });
  });

  it('maps video succeeded with source url', () => {
    const s = mapAgnesVideoStatus({ status: 'completed', remixed_from_video_id: 'https://x.test/v.mp4', seconds: 5 });
    if (s.status === 'succeeded') {
      expect(s.sourceUrl).toBe('https://x.test/v.mp4');
      expect(s.duration).toBe(5);
    } else {
      throw new Error('expected succeeded');
    }
  });

  it('throws when video completed without result url', () => {
    expect(() => mapAgnesVideoStatus({ status: 'completed' })).toThrow(ProviderError);
  });

  it('maps video failed', () => {
    const s = mapAgnesVideoStatus({ status: 'failed', error: { message: 'boom' } });
    expect(s).toMatchObject({ status: 'failed' });
    if (s.status === 'failed') expect(s.errorMessage).toContain('boom');
  });
});

describe('agnes provider (HTTP via mocked fetch)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  function okJson(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  function errJson(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  it('image success returns normalized url', async () => {
    fetchMock.mockResolvedValue(okJson({ data: [{ url: 'https://cdn.test/out.png' }] }));
    const out = await makeProvider().generateImage(
      { model: 'agn-dream', prompt: 'hi', mode: 'text2img' },
      'sk-1',
    );
    expect(out.sourceUrl).toBe('https://cdn.test/out.png');
    const [urlArg, init] = fetchMock.mock.calls[0];
    expect(String(urlArg)).toContain('/v1/images/generations');
    expect(init.headers.Authorization).toBe('Bearer sk-1');
  });

  it('video submit returns provider job id', async () => {
    fetchMock.mockResolvedValue(okJson({ task_id: 'task-abc' }));
    const sub = await makeProvider().submitVideo(
      { model: 'agn-v', prompt: 'drone', mode: 'text2video', width: 1280, height: 720, numFrames: 16, frameRate: 30 },
      'sk-1',
    );
    expect(sub.providerJobId).toBe('task-abc');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/videos');
  });

  it('video poll returns processing', async () => {
    fetchMock.mockResolvedValue(okJson({ status: 'in_progress', progress: 10 }));
    const s = await makeProvider().getVideoStatus('task-1', { model: 'agn-v', prompt: 'x', mode: 'text2video', width: 1, height: 1, numFrames: 1, frameRate: 1 }, 'sk-1');
    expect(s.status).toBe('processing');
  });

  it('video poll returns succeeded', async () => {
    fetchMock.mockResolvedValue(okJson({ status: 'completed', remixed_from_video_id: 'https://cdn.test/v.mp4' }));
    const s = await makeProvider().getVideoStatus('task-1', { model: 'agn-v', prompt: 'x', mode: 'text2video', width: 1, height: 1, numFrames: 1, frameRate: 1 }, 'sk-1');
    expect(s.status).toBe('succeeded');
  });

  it('video provider failed', async () => {
    fetchMock.mockResolvedValue(okJson({ status: 'failed', error: { message: 'generation failed' } }));
    const s = await makeProvider().getVideoStatus('task-1', { model: 'agn-v', prompt: 'x', mode: 'text2video', width: 1, height: 1, numFrames: 1, frameRate: 1 }, 'sk-1');
    expect(s.status).toBe('failed');
  });

  it('429 maps to RATE_LIMITED with retryAfter', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429, headers: { 'retry-after': '7' } }),
    );
    await expect(
      makeProvider().generateImage({ model: 'agn-dream', prompt: 'hi', mode: 'text2img' }, 'sk-1'),
    ).rejects.toMatchObject({ category: 'RATE_LIMITED', retryAfterMs: 7000 });
  });

  it('401 maps to AUTH_ERROR with degradeCredential', async () => {
    fetchMock.mockResolvedValue(errJson(401, { error: { message: 'bad key' } }));
    await expect(
      makeProvider().generateImage({ model: 'agn-dream', prompt: 'hi', mode: 'text2img' }, 'sk-1'),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', degradeCredential: true });
  });

  it('timeout maps to PROVIDER_TIMEOUT', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    fetchMock.mockRejectedValue(abort);
    const provider = new AgnesProvider({ baseUrl: BASE, timeoutMs: 1, guard: GUARD });
    await expect(
      provider.generateImage({ model: 'agn-dream', prompt: 'hi', mode: 'text2img' }, 'sk-1'),
    ).rejects.toMatchObject({ category: 'PROVIDER_TIMEOUT' });
  });

  it('malformed (non-JSON) response throws ProviderError', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    await expect(
      makeProvider().generateImage({ model: 'agn-dream', prompt: 'hi', mode: 'text2img' }, 'sk-1'),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});