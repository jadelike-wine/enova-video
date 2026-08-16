/**
 * 视频参数共享 helper。
 *
 * 全项目（API / Worker / Billing / Frontend）通过本模块计算视频时长，
 * 避免不同层各自算一种 duration 导致不一致。
 *
 * Agnes Video V2.0 协议定义：
 *   seconds = num_frames / frame_rate
 * （不是 (num_frames - 1) / frame_rate，协议示例 121 frames / 24 fps ≈ 5.04s 即为 121/24）
 */

export const VIDEO_FRAME_RATE_MIN = 1;
export const VIDEO_FRAME_RATE_MAX = 60;
export const VIDEO_NUM_FRAMES_MAX = 441;

/**
 * 从 numFrames + frameRate 计算视频时长（秒）。
 *
 * 使用 `numFrames / frameRate` 语义，与 Agnes 协议文档一致。
 *
 * @returns 视频时长（秒），如果缺少有效参数返回 null。
 */
export function resolveVideoDuration(params: {
  numFrames?: number | unknown;
  frameRate?: number | unknown;
}): number | null {
  const nf = Number(params.numFrames);
  const fr = Number(params.frameRate);
  if (!Number.isFinite(nf) || !Number.isFinite(fr) || nf <= 0 || fr <= 0) return null;
  return nf / fr;
}

/**
 * 从 input 对象提取视频时长（秒）。
 *
 * 兼容两种来源：
 * 1. 显式 `duration` 字段（历史/直接指定）
 * 2. `numFrames / frameRate`（Agnes 原生参数，推荐）
 *
 * 优先使用 numFrames/frameRate，因为前端不再发送 `duration` 字段。
 */
export function resolveVideoDurationFromInput(input: Record<string, unknown>): number | null {
  // 优先从 numFrames + frameRate 推导
  const duration = resolveVideoDuration({
    numFrames: input.numFrames,
    frameRate: input.frameRate,
  });
  if (duration !== null) return duration;

  // Fallback：显式 duration 字段（历史兼容或非 Agnes provider）
  const d = input.duration ? Number(input.duration) : NaN;
  if (Number.isFinite(d) && d > 0) return d;

  return null;
}

/**
 * 验证 Agnes Video V2.0 的 numFrames 参数。
 *
 * 规则（来自协议文档）：
 * - numFrames > 0
 * - numFrames <= 441
 * - (numFrames - 1) % 8 === 0  （8n + 1 规则）
 *
 * @returns 验证通过返回 true，失败返回错误消息。
 */
export function validateVideoNumFrames(numFrames: number): true | string {
  if (!Number.isFinite(numFrames) || numFrames <= 0) return 'numFrames must be a positive number';
  if (numFrames > VIDEO_NUM_FRAMES_MAX) return `numFrames must be <= ${VIDEO_NUM_FRAMES_MAX}`;
  if ((numFrames - 1) % 8 !== 0) return 'numFrames must follow 8n+1 rule (e.g. 97, 121, 193, 241, 441)';
  return true;
}

/**
 * 验证 Agnes Video V2.0 的 frameRate 参数。
 *
 * 规则：frame_rate 支持范围为 1–60。
 */
export function validateVideoFrameRate(frameRate: number): true | string {
  if (!Number.isFinite(frameRate) || frameRate < VIDEO_FRAME_RATE_MIN || frameRate > VIDEO_FRAME_RATE_MAX) {
    return `frameRate must be between ${VIDEO_FRAME_RATE_MIN} and ${VIDEO_FRAME_RATE_MAX}`;
  }
  return true;
}

/**
 * 验证视频 numFrames + frameRate 完整性。
 *
 * @returns 验证通过返回 null，失败返回第一个错误消息。
 */
export function validateVideoFrames(numFrames: number, frameRate: number): string | null {
  const nfCheck = validateVideoNumFrames(numFrames);
  if (nfCheck !== true) return nfCheck;
  const frCheck = validateVideoFrameRate(frameRate);
  if (frCheck !== true) return frCheck;
  return null;
}
