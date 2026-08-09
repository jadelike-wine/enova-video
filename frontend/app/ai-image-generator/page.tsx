import type { Metadata } from 'next'
import { LandingPage } from '../../components/marketing/LandingPage'
import { buildMetadata } from '../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: 'AI Image Generator',
  description:
    'Agnes AI Creator 的 AI 图片生成功能：基于 Agnes Image 2.1 Flash 的文生图、单图编辑与多图合成，支持多种尺寸，生成结果自动转存对象存储。免费、开源、可自托管。',
  path: '/ai-image-generator',
})

export default function AiImageGeneratorPage() {
  return (
    <LandingPage
      data={{
        title: 'AI 图片生成',
        subtitle:
          '基于 Agnes Image 2.1 Flash 的高画质图片生成，支持文生图、单图编辑与多图合成，多种尺寸可选。',
        intro: [
          'Agnes AI Creator 的 AI 图片生成功能，让您无需专业设计能力即可通过文字描述生成高质量图片。支持文生图、单图编辑（img2img）与多图合成（multi_img）三种模式。',
          '提供多种纵横比尺寸，满足社交媒体、插画、产品图等不同场景需求。生成的图片会自动转存到七牛云对象存储，方便长期保存与分享。',
        ],
        features: [
          { title: '文生图', desc: '仅通过文字描述即可生成图片，适合概念草图、插画与创意图片。' },
          { title: '单图编辑', desc: '上传一张参考图，结合提示词进行再创作与风格迁移。' },
          { title: '多图合成', desc: '上传多张图片，融合多元素生成全新画面。' },
          { title: '多尺寸选择', desc: '提供 1:1、横图、竖图等多种纵横比，适配不同使用场景。' },
          { title: '对象存储转存', desc: '生成结果自动上传到七牛云 CDN，链接长期有效，方便下载与分享。' },
          { title: '历史管理', desc: '自动保存生成历史，支持预览、放大、删除与参数回填重新生成。' },
        ],
        modelSlider: '支持的图片模型',
        usageTitle: '使用方法',
        usage: [
          '进入应用并点击左侧「图片生成」。',
          '选择生成模式（文生图 / 单图编辑 / 多图合成）与尺寸。',
          '输入提示词，必要时上传参考图片。',
          '点击「开始生成」，稍候即可预览并下载结果。',
        ],
        faqs: [
          {
            q: '图片生成支持哪些模型？',
            a: '主要使用 Agnes Image 2.1 Flash，可在图片生成页面的模型选择器中查看与切换。',
          },
          {
            q: '单图编辑和多图合成需要上传图片吗？',
            a: '需要。这两种模式依赖参考图片，上传功能需要后端配置七牛云对象存储。',
          },
          {
            q: '生成的图片能保存多久？',
            a: '配置了七牛云对象存储后，图片会转存到你的 CDN，可长期访问；未配置时使用临时链接。',
          },
        ],
        appHref: '/app/images',
        appCta: '生成图片',
        modelIds: ['agnes-image-2.1-flash'],
      }}
    />
  )
}