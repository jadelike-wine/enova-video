import { ApiErrorBody } from '@enova/contracts';

/**
 * 统一 API 客户端基类。
 * - 所有请求走 baseURL（浏览器为 `/api/v1`，服务端为 API 内部地址）。
 * - 注入 X-Request-ID。
 * - 错误统一解析为 { error: { code, message, requestId } }。
 * 具体类型化 client 由 OpenAPI 生成（见 src/generated.ts）。
 */

export interface HttpClientOptions {
  baseURL: string;
  headers?: Record<string, string>;
  requestId?: () => string;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody | undefined, fallback: string) {
    const msg =
      body?.error?.message ?? (status >= 500 ? 'Internal server error' : fallback);
    super(msg);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.requestId = body?.error?.requestId;
    this.details = body?.error?.details;
  }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  private url(path: string): string {
    return `${this.options.baseURL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async request<T>(path: string, init: RequestInit = {}, body?: unknown): Promise<T> {
    const headers = new Headers(this.options.headers);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (!headers.has('X-Request-ID')) {
      headers.set('X-Request-ID', this.options.requestId?.() ?? newRequestId());
    }
    const resp = await fetch(this.url(path), {
      ...init,
      headers,
      body: body !== undefined ? JSON.stringify(body) : init.body,
    });
    if (!resp.ok) {
      let parsed: ApiErrorBody | undefined;
      try {
        parsed = (await resp.json()) as ApiErrorBody;
      } catch {
        /* ignore malformed body */
      }
      throw new ApiClientError(resp.status, parsed, resp.statusText);
    }
    if (resp.status === 204) return undefined as T;
    return (await resp.json()) as T;
  }

  get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'POST' }, body);
  }

  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'PATCH' }, body);
  }

  delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  return new HttpClient(options);
}