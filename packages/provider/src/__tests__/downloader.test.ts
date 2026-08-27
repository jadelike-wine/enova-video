import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { downloadToTempFile } from '../storage/downloader.js';

async function downloadTempFiles(): Promise<Set<string>> {
  return new Set((await readdir(tmpdir())).filter((name) => name.startsWith('enova-dl-')));
}

describe('downloadToTempFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes its partial temp file when the streamed response exceeds maxBytes', async () => {
    const before = await downloadTempFiles();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        new Uint8Array([1, 2, 3, 4]),
        { status: 200, headers: { 'content-type': 'image/png' } },
      )),
    );

    await expect(downloadToTempFile('https://cdn.example.com/result.png', {
      guard: { allowHttp: false, resolveDns: false },
      maxBytes: 3,
      timeoutMs: 1_000,
      allowedContentTypePrefixes: ['image/'],
    })).rejects.toThrow(/too large/i);

    const after = await downloadTempFiles();
    expect([...after].filter((name) => !before.has(name))).toEqual([]);
  });
});
