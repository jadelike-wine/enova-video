/**
 * Central model catalog.
 *
 * `apiId` is the exact model ID sent to FastAPI / Agnes API — DO NOT change it.
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