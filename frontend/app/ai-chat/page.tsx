import type { Metadata } from 'next'
import { LandingPage } from '../../components/marketing/LandingPage'
import { buildMetadata } from '../../lib/seo'

export const metadata: Metadata = buildMetadata({
  title: 'AI Chat',
  description:
    'Agnes AI Creator 的 AI 对话功能：基于 Agnes 2.0 Flash 的多轮文本对话，支持流式逐字输出、Markdown 渲染、Thinking 模式与 Token 统计。免费、开源、可自托管。',
  path: '/ai-chat',
})

export default function AiChatPage() {
  return (
    <LandingPage
      data={{
        title: 'AI 对话',
        subtitle:
          '基于 Agnes 2.0 Flash 的高效多轮文本对话，逐字流式输出，支持 Markdown、Thinking 模式与 Token 统计。',
        intro: [
          'Agnes AI Creator 内置的 AI 对话功能，让您可以与 Agnes 2.0 Flash 展开自然流畅的多轮对话。无论是问答、写作、翻译、代码还是总结，都能得到快速而稳定的响应。',
          '对话以流式（SSE）方式逐字输出，无需等待整段生成结束即可阅读结果。消息支持完整的 Markdown 渲染，包括代码块、列表、表格与引用，非常适合技术交流与内容创作。',
        ],
        features: [
          { title: '流式逐字输出', desc: '基于 SSE 的 token-by-token 流式响应，边生成边显示，体验流畅不卡顿。' },
          { title: 'Markdown 渲染', desc: '消息完整支持 Markdown，代码块、列表、表格与引用均可正常展示。' },
          { title: '多轮对话', desc: '自动保存对话历史，可随时返回继续之前的对话，支持对话标题管理。' },
          { title: 'Thinking 模式', desc: '支持可选的思考模式，让模型在回答前进行更深入的推理。' },
          { title: 'Token 统计', desc: '每次回复展示 prompt / completion / total tokens 用量，一目了然。' },
          { title: '对话管理', desc: '支持新建、重命名、删除对话与单条消息，灵活管理你的对话记录。' },
        ],
        modelSlider: '支持的对话模型',
        usageTitle: '使用方法',
        usage: [
          '进入应用并点击左侧「文本对话」。',
          '在底部输入框输入你的问题，按回车发送。',
          '模型会以流式方式逐步生成回复。',
          '如需从头开始，点击「新建对话」即可开始一个新的会话。',
        ],
        faqs: [
          {
            q: 'AI 对话支持哪些模型？',
            a: '主要使用 Agnes 2.0 Flash。对话页面会从后端拉取可用模型列表，您可在模型选择器中切换。',
          },
          {
            q: '对话记录保存在哪里？',
            a: '对话历史保存在后端 SQLite 数据库中，关闭浏览器后依然可以重新打开继续对话。',
          },
          {
            q: '需要付费吗？',
            a: 'Agnes AI Creator 本身免费开源。模型调用使用 Agnes AI 的 API，相关用量以 Agnes AI 平台计费为准。',
          },
        ],
        appHref: '/app/chat',
        appCta: '开始对话',
        modelIds: ['agnes-2.0-flash'],
      }}
    />
  )
}