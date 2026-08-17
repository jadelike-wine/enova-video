'use client'

import { ArrowUpOutlined, DeleteOutlined, InboxOutlined, PictureOutlined } from '@ant-design/icons'
import { Button, Input, Segmented, Tooltip } from 'antd'
import ModelSelector from './ModelSelector.js'
import type { GenerationMode, InputImage } from './types.js'

export interface PromptComposerProps {
  prompt: string
  onPromptChange: (value: string) => void
  mode: GenerationMode
  model: string
  ratio: string
  size: string
  onModeChange: (value: GenerationMode) => void
  onModelChange: (value: string) => void
  onRatioChange: (value: string) => void
  onSizeChange: (value: string) => void
  inputImages?: InputImage[]
  onUpload: (file: File) => void | boolean
  onRemoveImage: (index: number) => void
  onSubmit: () => void
  generating?: boolean
  generateStep?: string
  error?: string
  balance?: number | string
  estimatedCost?: number | string
  modeOptions: Array<{ value: string; label: string }>
  disabled?: boolean
  maxLength?: number
}

export default function PromptComposer({ prompt, onPromptChange, mode, model, ratio, size, onModeChange, onModelChange, onRatioChange, onSizeChange, inputImages = [], onUpload, onRemoveImage, onSubmit, generating = false, generateStep, error, balance, estimatedCost, modeOptions, disabled, maxLength = 2000 }: PromptComposerProps) {
  const upload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.multiple = mode === 'multi_img'
    input.onchange = () => Array.from(input.files ?? []).forEach((file) => onUpload(file))
    input.click()
  }
  return <section className="image-creator-composer" aria-label="图片创作输入">
    {inputImages.length > 0 && <div className="image-creator-composer__previews">{inputImages.map((image, index) => <div className="image-creator-composer__preview" key={`${image.preview}-${index}`}><img src={image.preview} alt={`参考图 ${index + 1}`} /><button type="button" aria-label={`删除参考图 ${index + 1}`} onClick={() => onRemoveImage(index)}><DeleteOutlined /></button></div>)}</div>}
    <Input.TextArea value={prompt} onChange={(event) => onPromptChange(event.target.value)} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); onSubmit() } }} placeholder="描述你想创作的画面…" autoSize={{ minRows: 2, maxRows: 6 }} maxLength={maxLength} disabled={disabled || generating} aria-label="提示词" className="image-creator-composer__input" />
    <div className="image-creator-composer__toolbar">
      <Tooltip title="上传参考图"><Button type="text" icon={<InboxOutlined />} onClick={upload} disabled={disabled || generating} aria-label="上传参考图" /></Tooltip>
      <span className="image-creator-composer__count">{prompt.length}/{maxLength}</span>
      <Segmented size="small" value={mode} options={modeOptions} onChange={(value) => onModeChange(value as GenerationMode)} disabled={disabled || generating} />
      <ModelSelector model={model} ratio={ratio} size={size} onModelChange={onModelChange} onRatioChange={onRatioChange} onSizeChange={onSizeChange} disabled={disabled || generating} />
      <span className="image-creator-composer__balance">{estimatedCost != null ? `预计 ${estimatedCost} Credits` : ''}{balance != null ? ` · 余额 ${balance}` : ''}</span>
      <Button type="primary" shape="circle" icon={<ArrowUpOutlined />} onClick={onSubmit} loading={generating} disabled={disabled || generating || !prompt.trim()} aria-label={generating ? (generateStep === 'uploading' ? '正在上传' : '正在生成') : '开始生成'} />
    </div>
    {error && <p className="image-creator-composer__error" role="alert">{error}</p>}
    {mode !== 'text2img' && inputImages.length === 0 && <p className="image-creator-composer__hint"><PictureOutlined /> {mode === 'img2img' ? '上传一张参考图开始编辑' : '上传多张图片进行合成'}</p>}
  </section>
}
