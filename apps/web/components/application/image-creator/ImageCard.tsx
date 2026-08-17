'use client'

import { useState } from 'react'
import { Button, Tooltip } from 'antd'
import { CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, HeartFilled, HeartOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ImageCardActions, ImageTask } from './types.js'

export interface ImageCardProps extends ImageCardActions { task: ImageTask; className?: string }

export default function ImageCard({ task, onDownload, onRegenerate, onEdit, onCopyPrompt, onFavorite, onDelete, className = '' }: ImageCardProps) {
  const [favorite, setFavorite] = useState(false)
  const url = task.output_url
  if (!url) return null
  const toggleFavorite = () => { const next = !favorite; setFavorite(next); onFavorite?.(task, next) }
  return <article className={`image-creator-card ${className}`}><img src={url} alt={task.prompt || '生成图片'} loading="lazy" /><div className="image-creator-card__rail" aria-label="图片操作">
    <Tooltip title="下载"><Button type="text" icon={<DownloadOutlined />} onClick={() => onDownload?.(task)} aria-label="下载图片" /></Tooltip>
    <Tooltip title="重新生成"><Button type="text" icon={<ReloadOutlined />} onClick={() => onRegenerate?.(task)} aria-label="重新生成" /></Tooltip>
    <Tooltip title="编辑"><Button type="text" icon={<EditOutlined />} onClick={() => onEdit?.(task)} aria-label="编辑图片" /></Tooltip>
    <Tooltip title="复制提示词"><Button type="text" icon={<CopyOutlined />} onClick={() => onCopyPrompt?.(task.prompt)} aria-label="复制提示词" /></Tooltip>
    <Tooltip title={favorite ? '取消收藏' : '收藏'}><Button type="text" icon={favorite ? <HeartFilled /> : <HeartOutlined />} onClick={toggleFavorite} aria-label={favorite ? '取消收藏' : '收藏图片'} /></Tooltip>
    <Tooltip title="删除"><Button type="text" icon={<DeleteOutlined />} onClick={() => onDelete?.(task)} aria-label="删除图片" /></Tooltip>
  </div></article>
}
