import { ProviderError, providerErrorFromHttpStatus, type ProviderErrorCategory } from '../errors.js';
import type { AgnesErrorBody } from './agnes.types.js';

/**
 * Agnes 上游错误解析工具。
 * - 把 HTTP status 归类为 ProviderErrorCategory。
 * - 解析 Retry-After。
 * - 把 Agnes error body 归一化为简短、可读的错误信息（不含 secret）。
 */

function parseRetryAfterMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const v = Number.parseInt(raw.trim(), 10);
  if (Number.isFinite(v) && v > 0) return v * 1000;
  return undefined;
}

/** 等价于老 Python format_agnes_error：从 error body 提取简短可读信息。 */
export function formatAgnesError(err: unknown): string | null {
  if (err == null) return null;
  if (typeof err === 'string') {
    const text = err.trim();
    return text || null;
  }
  if (typeof err === 'object') {
    const body = err as AgnesErrorBody;
    for (const key of ['message', 'msg', 'detail', 'error', 'code', 'type'] as const) {
      const val = body[key];
      if (val == null || val === '') continue;
      if (typeof val === 'string') return val;
      if (typeof val === 'object') {
        const nested = formatAgnesError(val);
        if (nested) return nested;
      }
      return String(val);
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * 把一次 Agnes HTTP 响应（含 status 与可选的 error body）归类为 ProviderError。
 * 所有 Agnes 调用失败都必须经由本函数，禁止把完整响应/secret 放入 message。
 */
export function agnesHttpError(
  status: number,
  body: unknown,
  opts: { retryAfterMs?: number; code?: string; timeoutDeath?: boolean } = {},
): ProviderError {
  const message = formatAgnesError(body) ?? `Agnes API ${status}`;
  if (opts.timeoutDeath) {
    return new ProviderError(message, {
      category: 'PROVIDER_TIMEOUT',
      statusCode: status,
      code: opts.code,
    });
  }
  return providerErrorFromHttpStatus(message, status, {
    retryAfterMs: opts.retryAfterMs,
    code: opts.code,
  });
}

/** 从 Response 头解析 Retry-After（毫秒）。 */
export function retryAfterMsFromHeaders(headers: Headers): number | undefined {
  return parseRetryAfterMs(headers.get('retry-after'));
}

/** 把任意异常归类为 ProviderError（网络/解析/未知）。 */
export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err instanceof Error ? err : new Error(String(err));
  const text = e.message.toLowerCase();
  let category: ProviderErrorCategory = 'NETWORK_ERROR';
  if (text.includes('abort') || text.includes('timeout') || text.includes('timed out')) {
    category = 'PROVIDER_TIMEOUT';
  } else if (text.includes('ssrf') || text.includes('invalid url')) {
    category = 'PROVIDER_BAD_REQUEST';
  }
  return new ProviderError(e.message, { category, cause: err });
}