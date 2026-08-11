/**
 * Central model catalog.
 *
 * `apiId` is the exact model ID sent to the Agnes API — DO NOT change it.
 * `slug` is the SEO URL slug and may differ from the API id.
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
    apiId: 'agnes-2.0-flash',
    slug: 'agnes-2-0-flash',
    name: 'Agnes 2.0 Flash',
    kind: 'text',
    tagline: '快速、稳定的多轮文本对话模型',
    description:
      'Agnes 2.0 Flash 是面向日常对话与内容创作的高效文本模型，支持多轮对话、流式输出与可选的思考（Thinking）模式，适合问答、写作、翻译、代码与总结等场景。',
    capabilities: ['多轮对话', '流式输出', 'Thinking 模式', 'Token 统计'],
  },
  {
    apiId: 'agnes-1.5-flash',
    slug: 'agnes-1-5-flash',
    name: 'Agnes 1.5 Flash',
    kind: 'text',
    deprecated: true,
    tagline: '上一代文本模型（已弃用）',
    description:
      'Agnes 1.5 Flash 是上一代文本生成模型，目前已在产品中标记为已弃用。新对话建议使用 Agnes 2.0 Flash。',
    capabilities: ['多轮对话', '流式输出'],
  },
  {
    apiId: 'agnes-image-2.1-flash',
    slug: 'agnes-image-2-1-flash',
    name: 'Agnes Image 2.1 Flash',
    kind: 'image',
    tagline: '高画质文生图 / 图生图模型',
    description:
      'Agnes Image 2.1 Flash 支持文生图、单图编辑与多图合成，提供多种纵横比尺寸，可生成高质量图片并自动转存对象存储。',
    capabilities: ['文生图', '单图编辑 (img2img)', '多图合成', '多尺寸'],
  },
  {
    apiId: 'agnes-image-2.0-flash',
    slug: 'agnes-image-2-0-flash',
    name: 'Agnes Image 2.0 Flash',
    kind: 'image',
    tagline: '稳定的图片生成模型',
    description:
      'Agnes Image 2.0 Flash 提供稳定的文生图与图生图能力，适合作为备用图片生成通道。',
    capabilities: ['文生图', '单图编辑 (img2img)', '多尺寸'],
  },
  {
    apiId: 'agnes-video-v2.0',
    slug: 'agnes-video-v2-0',
    name: 'Agnes Video V2.0',
    kind: 'video',
    tagline: '文生视频 / 图生视频 / 关键帧动画',
    description:
      'Agnes Video V2.0 支持文本生成视频、图片生成视频、多图视频与关键帧动画，提供多种时长与分辨率预设，后台异步轮询任务进度。',
    capabilities: ['文生视频', '图生视频', '多图视频', '关键帧动画', '异步任务'],
  },
]

export const TEXT_MODELS = MODELS.filter((m) => m.kind === 'text')
export const IMAGE_MODELS = MODELS.filter((m) => m.kind === 'image')
export const VIDEO_MODELS = MODELS.filter((m) => m.kind === 'video')

export const DEFAULT_TEXT_MODEL = 'agnes-2.0-flash'
export const DEFAULT_IMAGE_MODEL = 'agnes-image-2.1-flash'
export const DEFAULT_VIDEO_MODEL = 'agnes-video-v2.0'

export function getModelBySlug(slug: string): ModelInfo | undefined {
  return MODELS.find((m) => m.slug === slug)
}

export function getModelByApiId(apiId: string | null | undefined): ModelInfo | undefined {
  if (!apiId) return undefined
  return MODELS.find((m) => m.apiId === apiId)
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

/** 图片可用尺寸（宽x高）。 */
export const IMAGE_SIZES: string[] = [
  '1024x1024',
  '1024x768',
  '768x1024',
  '1280x720',
  '720x1280',
]

/** 视频生成模式。 */
export const VIDEO_MODES: { id: string; name: string }[] = [
  { id: 'text2video', name: '文生视频' },
  { id: 'img2video', name: '图生视频' },
  { id: 'multi_img', name: '多图视频' },
  { id: 'keyframes', name: '关键帧动画' },
]

/** 视频时长预设。 */
export const VIDEO_FRAME_PRESETS: { label: string; numFrames: number; frameRate: number }[] = [
  { label: '4s', numFrames: 97, frameRate: 24 },
  { label: '5s', numFrames: 121, frameRate: 24 },
  { label: '8s', numFrames: 193, frameRate: 24 },
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