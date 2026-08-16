import { DomainError, ERROR_CODES } from '@enova/contracts';
import { ProviderError } from './errors.js';

/**
 * 业务层只依赖 AIProvider 抽象，禁止到处 fetch(provider.baseUrl + '/xxx')。
 * 增加新 Provider（OpenAI/Runway/Kling/Veo/Replicate）时无需改 Generation Service / Worker Pipeline。
 *
 * 所有 Provider 特有数据结构（Agnes 的 status string、task_id 等）必须在此归一化，
 * 业务代码不得依赖上游原始字段。
 */

/**
 * Agnes 原生尺寸档位。与协议文档 `agnes-image-2.1-flash.md` 的 `size` 参数一致。
 * 历史精确尺寸（如 `1024x768`）仅作为 backward-compatibility fallback 归一化到此类型。
 */
export type AgnesImageSize = '1K' | '2K' | '3K' | '4K';

/**
 * Agnes 原生宽高比。与协议文档支持的 `ratio` 参数一致。
 */
export type AgnesImageRatio = '1:1' | '3:4' | '4:3' | '16:9' | '9:16' | '2:3' | '3:2' | '21:9';

export interface GenerateImageInput {
  model: string;
  prompt: string;
  /** 尺寸档位（1K/2K/3K/4K）。新请求必须使用档位式 size，不再使用精确尺寸。 */
  size?: AgnesImageSize | string;
  /** 宽高比（1:1/4:3/16:9/...）。与 size 配合使用，使用协议原生模型。 */
  ratio?: AgnesImageRatio | string;
  mode?: 'text2img' | 'img2img' | 'multi_img';
  images?: string[]; // 参考图 URL
  responseFormat?: 'url' | 'b64_json';
}

/** 归一化后的图片生成结果。业务层只读 sourceUrl / base64。 */
export interface ProviderImageResult {
  /** 可下载的源 URL（优先）。 */
  sourceUrl?: string;
  /** base64 图片（上游未返回 URL 时）。 */
  base64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  revisedPrompt?: string;
  /** 上游元数据（不含任何 secret / Authorization）。 */
  providerMetadata?: Record<string, unknown>;
}

export interface GenerateVideoInput {
  model: string;
  prompt: string;
  negativePrompt?: string;
  mode: 'text2video' | 'img2video' | 'multi_img' | 'keyframes';
  width: number;
  height: number;
  numFrames: number;
  frameRate: number;
  images?: string[];
  image?: string;
  seed?: number;
  numInferenceSteps?: number;
}

/** 归一化后的视频任务状态。 */
export type ProviderJobStatus =
  | { status: 'processing'; progress?: number }
  | {
      status: 'succeeded';
      sourceUrl: string;
      duration?: number;
      width?: number;
      height?: number;
      providerMetadata?: Record<string, unknown>;
    }
  | { status: 'failed'; errorCode?: string; errorMessage?: string };

/** 视频提交结果：providerJobId 用于后续轮询。 */
export interface ProviderVideoSubmission {
  providerJobId: string;
  status: ProviderJobStatus;
}

/**
 * AI Provider 接口：图片/视频生成 + 状态轮询 + 取消。
 * 所有方法抛 ProviderError（见 ./errors.ts），禁止抛原始 HTTP 错误。
 */
export interface AIProvider {
  /** 与 providers.code 对应。 */
  readonly code: string;
  /** 管理员配置、已通过 SSRF 校验的 base URL。 */
  readonly baseUrl: string;

  generateImage(input: GenerateImageInput, credential: string): Promise<ProviderImageResult>;
  submitVideo(input: GenerateVideoInput, credential: string): Promise<ProviderVideoSubmission>;
  getVideoStatus(providerJobId: string, input: GenerateVideoInput, credential: string): Promise<ProviderJobStatus>;
  cancelJob(providerJobId: string, credential: string): Promise<void>;
}

// ---- 兼容导出：旧代码可能引用 ProviderUpstreamError / VideoJobStatus ----
/** @deprecated 使用 ProviderError（./errors.js）。 */
export class ProviderUpstreamError extends DomainError {
  constructor(
    message: string,
    opts: {
      statusCode?: number;
      retryAfter?: number;
      isAuth?: boolean;
      isRateLimit?: boolean;
      signature?: string;
    } = {},
  ) {
    let code: string = ERROR_CODES.PROVIDER_UPSTREAM_ERROR;
    if (opts.isRateLimit) code = ERROR_CODES.PROVIDER_RATE_LIMITED;
    else if (opts.isAuth) code = ERROR_CODES.PROVIDER_UNAUTHORIZED;
    const status = opts.statusCode ?? (opts.isRateLimit ? 429 : opts.isAuth ? 401 : 502);
    super({ code, message, statusCode: status, details: { retryAfter: opts.retryAfter, signature: opts.signature } });
    this.name = 'ProviderUpstreamError';
  }
}

export { ProviderError };

/** 聊天接口（与生成差异大，独立抽象，Phase 4 不实现）。 */
export interface ChatProvider {
  readonly code: string;
  chatCompletion(
    params: { model: string; messages: Message[]; stream: boolean } & Record<string, unknown>,
    credential: string,
  ): Promise<chatCompletionResult>;
  chatCompletionStream(
    params: { model: string; messages: Message[] } & Record<string, unknown>,
    credential: string,
  ): AsyncIterable<StreamChunk>;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface chatCompletionResult {
  content: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export type StreamChunk =
  | { type: 'content'; content: string }
  | { type: 'done'; usage?: Record<string, unknown> }
  | { type: 'error'; message: string };