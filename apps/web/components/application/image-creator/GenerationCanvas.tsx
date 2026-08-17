'use client'

import { Button, Spin } from 'antd'
import { RobotOutlined, ReloadOutlined } from '@ant-design/icons'
import ImageGrid from './ImageGrid.js'
import type { ImageCardActions, ImageTask, PreviewState } from './types.js'

export interface GenerationCanvasProps extends ImageCardActions {
  state: PreviewState
  task?: ImageTask | null
  tasks?: ImageTask[]
  progress?: number
  status?: string
  onRegenerate?: (task: ImageTask) => void
  className?: string
}

export default function GenerationCanvas({ state, task, tasks = task ? [task] : [], progress, status, onRegenerate, onDownload, onEdit, onCopyPrompt, onFavorite, onDelete, className = '' }: GenerationCanvasProps) {
  if (state === 'success') return <div className={`image-creator-canvas image-creator-canvas--success ${className}`}><ImageGrid tasks={tasks} onDownload={onDownload} onRegenerate={onRegenerate} onEdit={onEdit} onCopyPrompt={onCopyPrompt} onFavorite={onFavorite} onDelete={onDelete} /></div>
  if (state === 'generating') return <div className={`image-creator-canvas image-creator-canvas--generating ${className}`} aria-live="polite"><div className="image-creator-shimmer-grid">{[0, 1, 2, 3].map((item) => <div className="image-creator-shimmer" key={item} />)}</div><div className="image-creator-canvas__progress"><Spin size="small" /> <span>{status || (progress != null ? `正在生成 ${progress}%` : '正在创作…')}</span></div></div>
  if (state === 'error') return <div className={`image-creator-canvas image-creator-canvas--error ${className}`} role="alert"><RobotOutlined className="image-creator-canvas__mark" /><h2>生成失败</h2><p>这次创作没有完成，请稍后重试。</p>{task && onRegenerate && <Button icon={<ReloadOutlined />} onClick={() => onRegenerate(task)}>重新生成</Button>}</div>
  return <div className={`image-creator-canvas image-creator-canvas--empty ${className}`}><RobotOutlined className="image-creator-canvas__mark" /><h2>输入描述开始创作</h2><p>把你的想法写下来，生成第一张图片。</p></div>
}
