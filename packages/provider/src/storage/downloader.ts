import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { validateFetchableUrl, type UrlGuardOptions } from '../url-guard.js';

export type { UrlGuardOptions };

/**
 * 安全下载器：从上游 URL 拉取生成结果。
 * - 请求前做 SSRF 校验（防恶意 URL）。
 * - 限制：最大字节数 / 超时 / 重定向次数 / Content-Type。
 * - 流式写入临时文件，避免大视频整块载入内存。
 */

export interface DownloadResult {
  filePath: string;
  contentType: string;
  size: number;
}

export interface DownloadOptions {
  guard: UrlGuardOptions;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  allowedContentTypePrefixes: string[];
}

const DEFAULT_MAX_REDIRECTS = 5;

export async function downloadToTempFile(sourceUrl: string, opts: DownloadOptions): Promise<DownloadResult> {
  await validateFetchableUrl(sourceUrl, opts.guard);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let redirects = 0;
  let currentUrl = sourceUrl;
  let size = 0;
  let contentType = 'application/octet-stream';

  const filePath = join(tmpdir(), `enova-dl-${randomBytes(8).toString('hex')}.bin`);

  try {
    for (;;) {
      const res = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: '*/*' },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        if (++redirects > (opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS)) {
          throw domainError(ERROR_CODES.UPLOAD_INVALID, 'Too many redirects', 400);
        }
        const next = new URL(res.headers.get('location')!, currentUrl).toString();
        await validateFetchableUrl(next, opts.guard);
        currentUrl = next;
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel();
        throw domainError(ERROR_CODES.UPLOAD_INVALID, `Download failed: HTTP ${res.status}`, 400);
      }

      contentType = (res.headers.get('content-type') ?? 'application/octet-stream').toLowerCase();
      const len = Number(res.headers.get('content-length') ?? NaN);
      if (Number.isFinite(len) && len > opts.maxBytes) {
        await res.body?.cancel();
        throw domainError(ERROR_CODES.UPLOAD_INVALID, `File too large (${len} bytes)`, 413);
      }
      if (!opts.allowedContentTypePrefixes.some((p) => contentType.startsWith(p))) {
        await res.body?.cancel();
        throw domainError(ERROR_CODES.UPLOAD_INVALID, `Unexpected content-type: ${contentType}`, 400);
      }

      const out = createWriteStream(filePath);
      const body: Readable = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
      const onData = (chunk: Buffer | string): void => {
        size += chunk.length;
        if (size > opts.maxBytes) {
          controller.abort();
          out.destroy(new Error('max download size exceeded'));
        }
      };
      body.on('data', onData);
      try {
        await pipeline(body, out);
      } catch (e) {
        if (size > opts.maxBytes) {
          throw domainError(ERROR_CODES.UPLOAD_INVALID, 'File too large', 413);
        }
        throw e;
      }
      break;
    }
  } catch (error) {
    await cleanupTempFile(filePath);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return { filePath, contentType, size };
}

/** 删除临时文件。 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    /* 忽略清理失败 */
  }
}
