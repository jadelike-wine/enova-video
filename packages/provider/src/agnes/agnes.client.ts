import { agnesHttpError, toProviderError, retryAfterMsFromHeaders } from './agnes.errors.js';
import type { AgnesImageRequest, AgnesImageResponse, AgnesVideoRequest, AgnesVideoResponse } from './agnes.types.js';

/**
 * Agnes 上游 HTTP 客户端。
 * - 只关心与 Agnes 的 wire protocol，不包含任何业务逻辑。
 * - baseUrl 在构造时已通过 SSRF 校验（见 agnes.provider.ts）。
 * - 所有失败抛 ProviderError（见 agnes.errors.ts）。
 */

export interface AgnesClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export class AgnesClient {
  constructor(private readonly opts: AgnesClientOptions) {}

  private async request<T>(config: {
    method: 'GET' | 'POST';
    path: string;
    apiKey: string;
    json?: unknown;
    query?: Record<string, string>;
    timeoutMs: number;
  }): Promise<T> {
    const url = new URL(config.path.replace(/^\/+/, ''), this.baseUrlWithSlash());
    if (config.query) {
      for (const [k, v] of Object.entries(config.query)) url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: config.method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: config.method === 'POST' && config.json !== undefined ? JSON.stringify(config.json) : undefined,
        signal: controller.signal,
        redirect: 'manual',
      });

      if (!res.ok) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = res.statusText || undefined;
        }
        throw agnesHttpError(res.status, body, {
          retryAfterMs: retryAfterMsFromHeaders(res.headers),
          code: `AGNES_HTTP_${res.status}`,
        });
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw agnesHttpError(0, undefined, { code: 'AGNES_TIMEOUT', timeoutDeath: true });
      }
      throw toProviderError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  async generateImage(payload: AgnesImageRequest, apiKey: string): Promise<AgnesImageResponse> {
    return this.request<AgnesImageResponse>({
      method: 'POST',
      path: '/v1/images/generations',
      apiKey,
      json: payload,
      timeoutMs: this.opts.timeoutMs,
    });
  }

  async createVideo(payload: AgnesVideoRequest, apiKey: string): Promise<AgnesVideoResponse> {
    return this.request<AgnesVideoResponse>({
      method: 'POST',
      path: '/v1/videos',
      apiKey,
      json: payload,
      timeoutMs: this.opts.timeoutMs,
    });
  }

  /** 按 task_id 查询（GET /v1/videos/{task_id}）。 */
  async getVideoStatusByTask(taskId: string, modelName: string | undefined, apiKey: string): Promise<AgnesVideoResponse> {
    const query: Record<string, string> = {};
    if (modelName) query.model_name = modelName;
    return this.request<AgnesVideoResponse>({
      method: 'GET',
      path: `/v1/videos/${encodeURIComponent(taskId)}`,
      apiKey,
      query,
      timeoutMs: this.opts.timeoutMs,
    });
  }

  /** 按 video_id 查询（GET /agnesapi）。老 poller 主路径。 */
  async getVideoStatusByVideoId(videoId: string, modelName: string | undefined, apiKey: string): Promise<AgnesVideoResponse> {
    const query: Record<string, string> = { video_id: videoId };
    if (modelName) query.model_name = modelName;
    return this.request<AgnesVideoResponse>({
      method: 'GET',
      path: '/agnesapi',
      apiKey,
      query,
      timeoutMs: this.opts.timeoutMs,
    });
  }

  private baseUrlWithSlash(): string {
    return this.opts.baseUrl.endsWith('/') ? this.opts.baseUrl : `${this.opts.baseUrl}/`;
  }
}