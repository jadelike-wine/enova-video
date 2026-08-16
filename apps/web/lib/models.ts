/**
 * Central model catalog.
 *
 * 第一版只支持两个 Agnes 模型（图片 + 视频），不显示其他 Provider 或模型。
 * `apiId` 是发送到后端的模型 ID，不要修改。
 * `name`/`tagline`/`description` 是用户可见名称，不暴露底层模型/厂商名。
 */

export type ModelKind = 'text' | 'image' | 'video'

export interface ModelInfo {
  apiId: string
  slug: string
  name: string
  kind: ModelKind
  deprecated?: boolean
  tagline: string
  description: string
  capabilities: string[]
}

export const MODELS: ModelInfo[] = [
  {
    apiId: 'agnes-image-2.1-flash',
    slug: 'agnes-image-2-1-flash',
    name: 'Agnes Image 2.1 Flash',
    kind: 'image',
    tagline: '高画质文生图 / 图生图模型',
    description:
      '支持文生图、单图编辑与多图合成，提供多种纵横比尺寸，可生成高质量图片并自动转存对象存储。',
    capabilities: ['文生图', '单图编辑 (img2img)', '多图合成', '多尺寸'],
  },
  {
    apiId: 'agnes-video-v2.0',
    slug: 'agnes-video-v2-0',
    name: 'Agnes Video V2.0',
    kind: 'video',
    tagline: '文生视频 / 图生视频',
    description:
      '支持文本生成视频和图片生成视频，提供多种时长与分辨率预设，后台异步轮询任务进度。',
    capabilities: ['文生视频', '图生视频', '异步任务', '真实进度'],
  },
]

export const IMAGE_MODELS = MODELS.filter((m) => m.kind === 'image')
export const VIDEO_MODELS = MODELS.filter((m) => m.kind === 'video')

export const DEFAULT_IMAGE_MODEL = 'agnes-image-2.1-flash'
export const DEFAULT_VIDEO_MODEL = 'agnes-video-v2.0'

export function getModelBySlug(slug: string): ModelInfo | undefined {
  return MODELS.find((m) => m.slug === slug)
}

export function getModelByApiId(apiId: string | null | undefined): ModelInfo | undefined {
  if (!apiId) return undefined
  return MODELS.find((m) => m.apiId === apiId)
}
/** 将真实模型 apiId 映射为用户可见的中性名称，避免向用户暴露底层模型标识。 */
export function modelDisplayName(apiId: string | null | undefined): string {
  const model = getModelByApiId(apiId)
  return model ? model.name : apiId ?? '—'
}

// ---------------------------------------------------------------------------
// 生成表单预设（新架构不再有后端 /models 元数据端点，前端本地维护）
// ---------------------------------------------------------------------------

/** 图片生成模式。 */
export const IMAGE_MODES: { id: string; name: string }[] = [
  { id: 'text2img', name: '文生图' },
  { id: 'img2img', name: '单图编辑' },
  { id: 'multi_img', name: '多图合成' },
]

/** 图片可用尺寸（宽x高）。 @deprecated 使用 IMAGE_QUALITY_SIZES + IMAGE_RATIOS 正交选择器。 */
export const IMAGE_SIZES: string[] = [
  '1024x1024',
  '1024x768',
  '768x1024',
  '1280x720',
  '720x1280',
]

/** 图片质量/分辨率档位（Agnes 原生 size 参数）。 */
export const IMAGE_QUALITY_SIZES: { id: string; label: string }[] = [
  { id: '1K', label: '1K' },
  { id: '2K', label: '2K' },
  { id: '3K', label: '3K' },
  { id: '4K', label: '4K' },
]

/** 图片宽高比（Agnes 原生 ratio 参数）。 */
export const IMAGE_RATIOS: { id: string; label: string; group: string }[] = [
  { id: '1:1', label: '1:1', group: 'square' },
  { id: '4:3', label: '4:3', group: 'landscape' },
  { id: '3:4', label: '3:4', group: 'portrait' },
  { id: '16:9', label: '16:9', group: 'landscape' },
  { id: '9:16', label: '9:16', group: 'portrait' },
  { id: '2:3', label: '2:3', group: 'portrait' },
  { id: '3:2', label: '3:2', group: 'landscape' },
  { id: '21:9', label: '21:9', group: 'landscape' },
]

/**
 * Agnes 图片输出尺寸参考表（来自协议文档）。
 * 用于 UI 辅助展示真实输出像素，但发送给后端的仍然是 size + ratio。
 */
export const IMAGE_OUTPUT_DIMENSIONS: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '3K': '3072x3072', '4K': '4096x4096' },
  '3:4': { '1K': '864x1152', '2K': '1728x2304', '3K': '2592x3456', '4K': '3456x4608' },
  '4:3': { '1K': '1152x864', '2K': '2304x1728', '3K': '3456x2592', '4K': '4608x3456' },
  '16:9': { '1K': '1312x736', '2K': '2624x1472', '3K': '3936x2208', '4K': '5248x2944' },
  '9:16': { '1K': '736x1312', '2K': '1472x2624', '3K': '2208x3936', '4K': '2944x5248' },
  '2:3': { '1K': '832x1248', '2K': '1664x2496', '3K': '2496x3744', '4K': '3328x4992' },
  '3:2': { '1K': '1248x832', '2K': '2496x1664', '3K': '3744x2496', '4K': '4992x3328' },
  '21:9': { '1K': '1568x672', '2K': '3136x1344', '3K': '4704x2016', '4K': '6272x2688' },
}

/** 根据历史精确尺寸（如 '1280x720'）归一化为 { size, ratio }。仅用于 backward compatibility fallback。 */
export function legacySizeToNative(size: string): { size: string; ratio: string } | null {
  const map: Record<string, string> = {
    '1024x1024': '1:1',
    '1024x768': '4:3',
    '768x1024': '3:4',
    '1280x720': '16:9',
    '720x1280': '9:16',
  }
  const ratio = map[size]
  if (ratio) return { size: '1K', ratio }
  return null
}

/** 获取给定 size + ratio 的实际输出像素尺寸（用于 UI 辅助展示）。 */
export function getImageOutputDimensions(size: string, ratio: string): string | null {
  const row = IMAGE_OUTPUT_DIMENSIONS[ratio]
  if (!row) return null
  return row[size] ?? null
}

/** 视频生成模式。第一版只支持文生视频和图生视频。 */
export const VIDEO_MODES: { id: string; name: string }[] = [
  { id: 'text2video', name: '文生视频' },
  { id: 'img2video', name: '图生视频' },
]

/** 视频时长预设。Agnes 协议支持 num_frames <= 441，遵循 8n+1 规则。 */
export const VIDEO_FRAME_PRESETS: { label: string; numFrames: number; frameRate: number }[] = [
  { label: '4s', numFrames: 97, frameRate: 24 },
  { label: '5s', numFrames: 121, frameRate: 24 },
  { label: '8s', numFrames: 193, frameRate: 24 },
  { label: '10s', numFrames: 241, frameRate: 24 },
  { label: '18s', numFrames: 441, frameRate: 24 },
]

/** 视频分辨率预设。 */
export const VIDEO_RESOLUTION_PRESETS: {
  id: string
  group: string
  label: string
  width: number
  height: number
}[] = [
  { id: '720p-h', group: 'landscape', label: '720p 横屏', width: 1280, height: 720 },
  { id: '1080p-h', group: 'landscape', label: '1080p 横屏', width: 1920, height: 1080 },
  { id: '720p-v', group: 'portrait', label: '720p 竖屏', width: 720, height: 1280 },
  { id: '1080p-v', group: 'portrait', label: '1080p 竖屏', width: 1080, height: 1920 },
]
