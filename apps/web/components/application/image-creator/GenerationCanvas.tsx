'use client'

import { useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import { RobotOutlined, ReloadOutlined, EditOutlined, DownloadOutlined, CopyOutlined, DeleteOutlined, HeartFilled, HeartOutlined } from '@ant-design/icons'
import ImageGrid from './ImageGrid'
import { modelDisplayName } from '../../../lib/models'
import { getImageOutputDimensions } from '../../../lib/models'
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

/**
 * 生成结果卡片 — 聊天流模式。
 *
 * 信息架构（参考即梦/jimeng.ai）：
 *   用户消息气泡（Prompt）
 *   → 生成结果（图片 grid）
 *   → 生成信息（模型 | 比例 | 分辨率 | 时间）
 *   → 操作按钮（重新编辑 | 再次生成 | 下载 | 更多）
 */
export default function GenerationCanvas({ state, task, tasks = task ? [task] : [], progress, status, error, errorMessage, onRegenerate, onDownload, onEdit, onCopyPrompt, onFavorite, onDelete, className = '' }: GenerationCanvasProps) {
  const [favorite, setFavorite] = useState(false)
  const displayedError = errorMessage || error || '这次创作没有完成，请稍后重试。'
  const canvasClassName = `${styles['image-creator-canvas']} ${styles[`image-creator-canvas--${state}`]} ${className}`

  useEffect(() => {
    setFavorite(false)
  }, [task?.id])

  const toggleFavorite = () => {
    if (!task) return
    const next = !favorite
    setFavorite(next)
    onFavorite?.(task, next)
  }

  if (state === 'success') {
    const createdAt = formatCreatedAt(task?.created_at)
    const modelName = task?.model ? modelDisplayName(task.model) : null
    const dimensions = task?.size && task?.ratio ? getImageOutputDimensions(task.size, task.ratio) : null
    const metadataItems: string[] = []
    if (modelName) metadataItems.push(modelName)
    if (task?.ratio) metadataItems.push(task.ratio)
    if (task?.size) metadataItems.push(task.size)
    if (dimensions) metadataItems.push(dimensions)
    if (createdAt) metadataItems.push(`生成时间 ${createdAt}`)

    return <div className={canvasClassName}>
      <div className={styles['image-creator-chat-turn']}>
        {/* 用户消息气泡：完整 Prompt，左对齐、不截断、支持多行 */}
        {task?.prompt && <div className={styles['image-creator-user-bubble']}>
          <p>{task.prompt}</p>
        </div>}

        {/* AI 生成结果 */}
        <div className={styles['image-creator-result-card']}>
          <ImageGrid tasks={tasks} />

          {/* 生成信息 metadata — 在图片下方 */}
          {metadataItems.length > 0 && <div className={styles['image-creator-result-meta']}>
            {metadataItems.map((item, index) => <span key={index}>{item}</span>)}
          </div>}

          {/* 操作按钮 */}
          <div className={styles['image-creator-result-actions']}>
            {onEdit && task && <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(task)}>重新编辑</Button>}
            {onRegenerate && task && <Button size="small" icon={<ReloadOutlined />} onClick={() => onRegenerate(task)}>再次生成</Button>}
            {onDownload && task && <Button size="small" icon={<DownloadOutlined />} onClick={() => onDownload(task)}>下载</Button>}
            {task?.prompt && onCopyPrompt && <Button size="small" icon={<CopyOutlined />} onClick={() => onCopyPrompt(task.prompt)}>复制提示词</Button>}
            {onFavorite && task && <Button size="small" icon={favorite ? <HeartFilled /> : <HeartOutlined />} onClick={toggleFavorite}>{favorite ? '取消收藏' : '收藏'}</Button>}
            {task && onDelete && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(task)}>删除</Button>}
          </div>
        </div>
      </div>
    </div>
  }

  if (state === 'generating') {
    return <div className={canvasClassName} aria-live="polite">
      <div className={styles['image-creator-chat-turn']}>
        {/* 用户消息气泡 */}
        {task?.prompt && <div className={styles['image-creator-user-bubble']}>
          <p>{task.prompt}</p>
        </div>}
        {/* 生成中占位 */}
        <div className={styles['image-creator-result-card']}>
          <div className={styles['image-creator-shimmer-grid']}>{[0, 1, 2, 3].map((item) => <div className={styles['image-creator-shimmer']} key={item} />)}</div>
          <div className={styles['image-creator-canvas__progress']}><Spin size="small" /> <span>{status || (progress != null ? `正在生成 ${progress}%` : '正在创作…')}</span></div>
        </div>
      </div>
    </div>
  }

  if (state === 'error') {
    return <div className={canvasClassName} role="alert">
      <div className={styles['image-creator-chat-turn']}>
        {/* 用户消息气泡 */}
        {task?.prompt && <div className={styles['image-creator-user-bubble']}>
          <p>{task.prompt}</p>
        </div>}
        {/* 错误结果 */}
        <div className={styles['image-creator-result-card']}>
          <RobotOutlined className={styles['image-creator-canvas__mark']} />
          <h2>生成失败</h2>
          <p>{displayedError}</p>
          {task && onRegenerate && <Button icon={<ReloadOutlined />} onClick={() => onRegenerate(task)}>重新生成</Button>}
        </div>
      </div>
    </div>
  }

  // empty
  return <div className={canvasClassName}>
    <RobotOutlined className={styles['image-creator-canvas__mark']} />
    <h2>输入描述开始创作</h2>
    <p>把你的想法写下来，生成第一张图片。</p>
  </div>
}
