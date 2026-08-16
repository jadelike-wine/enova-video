import type {
  AIProvider,
  GenerateImageInput,
  GenerateVideoInput,
  ProviderImageResult,
  ProviderJobStatus,
  ProviderVideoSubmission,
} from '../ai-provider.interface.js';
import { ProviderError } from '../errors.js';
import { validateFetchableUrl, type UrlGuardOptions } from '../url-guard.js';
import { AgnesClient } from './agnes.client.js';
import {
  extractProviderJobId,
  mapAgnesImageResponse,
  mapAgnesVideoStatus,
  mapAgnesVideoSubmission,
} from './agnes.mapper.js';
import type { AgnesImageRequest, AgnesVideoRequest } from './agnes.types.js';

/**
 * Agnes Provider：把平台归一化输入映射为 Agnes wire protocol，并归一化返回。
 * - baseUrl 为管理员配置，构造时已通过 SSRF 校验。
 * - 详细协议见 ./agnes.client.ts。
 */

export interface AgnesProviderOptions {
  baseUrl: string;
  timeoutMs: number;
  /** SSRF guard；开发环境可放行 http / 本地 host。 */
  guard: UrlGuardOptions;
}

export class AgnesProvider implements AIProvider {
  readonly code = 'agnes';
  readonly baseUrl: string;
  private readonly client: AgnesClient;

  constructor(opts: AgnesProviderOptions) {
    if (!opts.baseUrl) {
      throw new ProviderError('Agnes provider base_url is empty', { category: 'PROVIDER_BAD_REQUEST' });
    }
    this.baseUrl = opts.baseUrl;
    this.client = new AgnesClient({ baseUrl: opts.baseUrl, timeoutMs: opts.timeoutMs });
  }

  /** 异步工厂：先做 SSRF 校验，再创建实例（Worker 装配时 fail-fast）。 */
  static async create(opts: AgnesProviderOptions): Promise<AgnesProvider> {
    await validateFetchableUrl(opts.baseUrl, opts.guard);
    return new AgnesProvider(opts);
  }

  async generateImage(input: GenerateImageInput, credential: string): Promise<ProviderImageResult> {
    const payload: AgnesImageRequest = {
      model: input.model,
      prompt: input.prompt,
      // 新请求使用原生 size + ratio 模型（1K/2K/3K/4K + 16:9 等）。
      // 历史精确尺寸（如 1280x720）仅作为 fallback 传入，由 Agnes 自动标准化。
      size: input.size,
      ...(input.ratio ? { ratio: input.ratio } : {}),
    };
    if (input.mode === 'text2img' || !input.mode) {
      if (input.responseFormat === 'b64_json') payload.return_base64 = true;
      else payload.extra_body = { response_format: input.responseFormat ?? 'url' };
    } else {
      const images = input.images ?? [];
      if (images.length === 0) {
        throw new ProviderError(`${input.mode} mode requires input images`, { category: 'PROVIDER_BAD_REQUEST' });
      }
      payload.extra_body = {
        image: input.mode === 'img2img' ? images[0] : images,
        response_format: input.responseFormat ?? 'url',
      };
    }
    const resp = await this.client.generateImage(payload, credential);
    return mapAgnesImageResponse(resp);
  }

  async submitVideo(input: GenerateVideoInput, credential: string): Promise<ProviderVideoSubmission> {
    const payload: AgnesVideoRequest = {
      model: input.model,
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      num_frames: input.numFrames,
      frame_rate: input.frameRate,
    };
    if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
    if (input.numInferenceSteps !== undefined) payload.num_inference_steps = input.numInferenceSteps;
    if (input.seed !== undefined) payload.seed = input.seed;

    // ---- Video mode → Agnes wire protocol mapping ----
    //
    // Business layer uses provider-agnostic mode names:
    //   text2video  → (no extra fields needed, Agnes defaults to text-to-video)
    //   img2video   → Agnes image-to-video: set top-level `image` (single URL).
    //                 Agnes does NOT use `mode: "ti2vid"`; the presence of
    //                 a top-level `image` field signals image-to-video semantics.
    //   keyframes   → Agnes keyframe animation: set `extra_body.image[]` (array)
    //                 and `extra_body.mode = "keyframes"`.
    //   multi_img   → Agnes multi-image: set `extra_body.image[]` (array),
    //                 no `extra_body.mode` (not keyframes).
    //
    // Do NOT send `mode: "img2video"` or `mode: "ti2vid"` to Agnes.
    // The business-layer mode names are translated here and only here.
    if (input.mode === 'img2video') {
      const img = input.image ?? input.images?.[0];
      if (!img) throw new ProviderError('img2video requires an input image', { category: 'PROVIDER_BAD_REQUEST' });
      payload.image = img;
    } else if (input.mode === 'multi_img' || input.mode === 'keyframes') {
      const imgs = input.images ?? [];
      if (imgs.length < 2) {
        throw new ProviderError(`${input.mode} requires at least 2 images`, { category: 'PROVIDER_BAD_REQUEST' });
      }
      payload.extra_body = { image: imgs, ...(input.mode === 'keyframes' ? { mode: 'keyframes' } : {}) };
    } else if (input.mode !== 'text2video') {
      throw new ProviderError(`Unsupported video mode: ${input.mode}`, { category: 'PROVIDER_BAD_REQUEST' });
    }

    const resp = await this.client.createVideo(payload, credential);
    return mapAgnesVideoSubmission(resp);
  }

  async getVideoStatus(providerJobId: string, input: GenerateVideoInput, credential: string): Promise<ProviderJobStatus> {
    // Agnes 视频轮询优先使用 video_id 端点（GET /agnesapi?video_id=...）。
    // extractProviderJobId 优先返回 video_id，因此 providerJobId 通常就是 video_id。
    // 404 时回退到 task 端点（GET /v1/videos/{task_id}），兼容旧路径。
    try {
      const resp = await this.client.getVideoStatusByVideoId(providerJobId, input.model, credential);
      return mapAgnesVideoStatus(resp);
    } catch (err) {
      if (err instanceof ProviderError && err.statusCode === 404) {
        const resp = await this.client.getVideoStatusByTask(providerJobId, input.model, credential);
        return mapAgnesVideoStatus(resp);
      }
      throw err;
    }
  }

  async cancelJob(providerJobId: string, credential: string): Promise<void> {
    // Agnes 未提供标准 cancel 端点；本地取消（不释放/不结算），由业务层确保不再 settle。
    // 保留接口签名，实际为空操作，避免未来 Provider 支持时改动调用方。
    void providerJobId;
    void credential;
  }
}

export { extractProviderJobId };
export type { AgnesVideoRequest };