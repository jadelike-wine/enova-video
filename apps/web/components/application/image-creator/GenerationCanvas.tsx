'use client'

import { Button, Spin } from 'antd'
import { RobotOutlined, ReloadOutlined } from '@ant-design/icons'
import ImageGrid from './ImageGrid'
import { conversationTitle, taskMetadata } from './workbench'
import type { ImageCardActions, ImageTask, PreviewState } from './types'
import styles from './image-creator.module.css'

export interface GenerationCanvasProps extends ImageCardActions {
  state: PreviewState
  task?: ImageTask | null
  tasks?: ImageTask[]
  progress?: number
  status?: string
  error?: string
  errorMessage?: string
  className?: string
}

function formatCreatedAt(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export default function GenerationCanvas({ state, task, tasks = task ? [task] : [], progress, status, error, errorMessage, onRegenerate, onDownload, onEdit, onCopyPrompt, onFavorite, onDelete, className = '' }: GenerationCanvasProps) {
  const displayedError = errorMessage || error || '这次创作没有完成，请稍后重试。'
  const canvasClassName = `${styles['image-creator-canvas']} ${styles[`image-creator-canvas--${state}`]} ${className}`

  if (state === 'success') {
    const metadata = taskMetadata(task ?? null)
    const createdAt = formatCreatedAt(task?.created_at)
    const title = task?.prompt ? conversationTitle(task, '未命名对话') : ''
    return <div className={canvasClassName}>
      {task?.prompt && <div className={styles['image-creator-canvas__context']}>
        <h2>{title}</h2>
        <p>{task.prompt}</p>
        <div className={styles['image-creator-canvas__metadata']}>
          {metadata.map((value) => <span key={value}>{value}</span>)}
          {createdAt && <span>生成于 {createdAt}</span>}
        </div>
      </div>}
      <ImageGrid tasks={tasks} onDownload={onDownload} onRegenerate={onRegenerate} onEdit={onEdit} onCopyPrompt={onCopyPrompt} onFavorite={onFavorite} onDelete={onDelete} />
    </div>
  }
  if (state === 'generating') return <div className={canvasClassName} aria-live="polite"><div className={styles['image-creator-shimmer-grid']}>{[0, 1, 2, 3].map((item) => <div className={styles['image-creator-shimmer']} key={item} />)}</div><div className={styles['image-creator-canvas__progress']}><Spin size="small" /> <span>{status || (progress != null ? `正在生成 ${progress}%` : '正在创作…')}</span></div></div>
  if (state === 'error') return <div className={canvasClassName} role="alert"><RobotOutlined className={styles['image-creator-canvas__mark']} /><h2>生成失败</h2><p>{displayedError}</p>{task && onRegenerate && <Button icon={<ReloadOutlined />} onClick={() => onRegenerate(task)}>重新生成</Button>}</div>
  return <div className={canvasClassName}><RobotOutlined className={styles['image-creator-canvas__mark']} /><h2>输入描述开始创作</h2><p>把你的想法写下来，生成第一张图片。</p></div>
}
