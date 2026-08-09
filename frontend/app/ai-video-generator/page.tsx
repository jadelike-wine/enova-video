import type { Metadata } from 'next'
import { LandingPage } from '../../components/marketing/LandingPage'
import { buildMetadata } from '../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: 'AI Video Generator',
  description:
    'Agnes AI Creator 的 AI 视频生成功能：基于 Agnes Video V2.0 的文生视频、图生视频、多图视频与关键帧动画，后台异步轮询任务进度。免费、开源、可自托管。',
  path: '/ai-video-generator',
})

export default function AiVideoGeneratorPage() {
  return (
    <LandingPage
      data={{
        title: 'AI 视频生成',
        subtitle:
          '基于 Agnes Video V2.0 的文生视频、图生视频、多图视频与关键帧动画，多种时长与分辨率可选。',
        intro: [
          'Agnes AI Creator 的 AI 视频生成功能，让您通过文字或图片描述即可创建视频。支持文生视频、图生视频、多图视频与关键帧动画四种模式。',
          '提供横屏/竖屏多种分辨率与多种时长预设，后台以异步任务方式生成，可实时查看进度并在完成后播放、下载。',
        ],
        features: [
          { title: '文生视频', desc: '仅通过文字描述视频内容、动作与镜头运动即可生成视频。' },
          { title: '图生视频', desc: '上传一张图片作为起始帧，生成动态延续的视频。' },
          { title: '多图视频', desc: '上传多张图片，串联产生过渡与动画效果。' },
          { title: '关键帧动画', desc: '通过关键帧控制画面走向，实现更精细的动画生成。' },
          { title: '异步任务', desc: '生成在后台异步执行，任务列表实时显示进度，支持手动刷新状态。' },
          { title: '参数回填', desc: '可一键将历史任务参数填充回表单，方便复现与调整。' },
        ],
        modelSlider: '支持的视频模型',
        usageTitle: '使用方法',
        usage: [
          '进入应用并点击左侧「视频生成」。',
          '选择生成模式与分辨率、时长参数。',
          '输入提示词，按模式需要上传参考图片。',
          '点击「开始生成」，等待任务完成即可播放与下载。',
        ],
        faqs: [
          {
            q: '视频生成支持哪些模式和模型？',
            a: '支持文生视频、图生视频、多图视频与关键帧动画，主要使用 Agnes Video V2.0 模型。',
          },
          {
            q: '视频生成需要等待多久？',
            a: '视频生成属于异步任务，通常需要数分钟。任务列表会实时显示进度，完成后即可播放。',
          },
          {
            q: '图生视频等模式需要配置对象存储吗？',
            a: '需要。涉及参考图上传的模式依赖后端七牛云对象存储配置，未配置时仅文生视频可用。',
          },
        ],
        appHref: '/app/videos',
        appCta: '生成视频',
        modelIds: ['agnes-video-v2.0'],
      }}
    />
  )
}