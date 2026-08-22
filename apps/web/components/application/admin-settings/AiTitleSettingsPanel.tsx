'use client'

import { SettingGrid, SettingsSaveFooter, SettingsSection, settingsDirty } from './SettingsPanelPrimitives'
import type { SettingsPanelProps } from './SettingsPanelPrimitives'

const PROMPT_KEYS = ['ai.titleGenerationPromptZh', 'ai.titleGenerationPromptEn']

export default function AiTitleSettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved }: SettingsPanelProps) {
  const connection = settings.filter((setting) => !PROMPT_KEYS.includes(setting.key))
  const prompts = settings.filter((setting) => PROMPT_KEYS.includes(setting.key))
  return <div data-testid="ai-title-settings-panel" className="space-y-5">
    <div className="text-sm leading-relaxed text-gray-500">标题生成与图片/视频任务解耦：配置缺失、模型响应异常或仍在生成时，用户端始终展示“未命名对话”，不会影响创作任务和 Credits。</div>
    <SettingsSection title="OpenAI 兼容连接" description="API Key 在服务端加密存储；Base URL 会经过 SSRF 校验。"><SettingGrid settings={connection} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>
    <SettingsSection title="语言提示词" description="按用户提示词是否包含中文自动选择。{{prompt}} 是可选占位符。"><SettingGrid settings={prompts} drafts={drafts} onDraftChange={onDraftChange} multilineKeys={PROMPT_KEYS} /></SettingsSection>
    <SettingsSaveFooter dirty={settingsDirty(settings, drafts)} saving={saving} saved={saved} onSave={() => void onBatchSave(settings.map((setting) => setting.key))} note="保存后下一条生成任务立即使用新配置；无需重启。" />
  </div>
}
