/**
 * Agnes 上游原始协议类型（仅存在于 Agnes Provider 内部，绝不允许泄漏到业务层）。
 * 业务层只能看到 ai-provider.interface.ts 中的归一化类型。
 */

// ---- Image ----
export interface AgnesImageRequest {
  model: string;
  prompt: string;
  size?: string;
  /** 历史兼容：text2img 时可用。 */
  return_base64?: boolean;
  /** 非 text2img 模式（img2img / multi_img）的额外参数。 */
  extra_body?: {
    image?: string | string[];
    response_format?: 'url' | 'b64_json';
  };
}

export interface AgnesImageItem {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface AgnesImageResponse {
  data?: AgnesImageItem[];
  duration_ms?: number;
  [k: string]: unknown;
}

// ---- Video ----
export interface AgnesVideoRequest {
  model: string;
  prompt: string;
  width: number;
  height: number;
  num_frames: number;
  frame_rate: number;
  negative_prompt?: string;
  num_inference_steps?: number;
  seed?: number;
  /** img2video 单图。 */
  image?: string;
  /** multi_img / keyframes 多图。 */
  extra_body?: {
    image?: string | string[];
    mode?: string;
  };
}

/** 视频提交 / 状态查询共用的上游状态字符串。 */
export type AgnesVideoStatus = 'queued' | 'in_progress' | 'processing' | 'completed' | 'failed' | (string & {});

export interface AgnesVideoResponse {
  /** 提交时返回：task_id 或 id。 */
  task_id?: string;
  id?: string;
  /** 状态查询所需。 */
  video_id?: string;
  status?: AgnesVideoStatus;
  progress?: number;
  seconds?: number;
  size?: number;
  duration_ms?: number;
  /** completed 时返回：结果视频 URL。 */
  remixed_from_video_id?: string;
  error?: unknown;
  [k: string]: unknown;
}

/** Agnes 上游错误体（用于 format_agnes_error 等价解析）。 */
export interface AgnesErrorBody {
  message?: string;
  msg?: string;
  detail?: string;
  error?: unknown;
  code?: string;
  type?: string;
  [k: string]: unknown;
}