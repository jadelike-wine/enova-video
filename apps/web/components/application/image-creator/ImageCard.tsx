'use client'

import { Image } from 'antd'
import type { ImageTask } from './types'
import styles from './image-creator.module.css'

export interface ImageCardProps { task: ImageTask; className?: string }

export default function ImageCard({ task, className = '' }: ImageCardProps) {
  const url = task.output_url
  if (!url) return null
  return <article className={`${styles['image-creator-card']} ${className}`}>
    <Image
      src={url}
      alt={task.prompt || '生成图片'}
      preview={{ mask: null }}
      width="100%"
      height="100%"
      className={styles['image-creator-card__image']}
    />
  </article>
}
