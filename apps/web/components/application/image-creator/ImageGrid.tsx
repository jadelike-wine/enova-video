'use client'

import ImageCard from './ImageCard.js'
import type { ImageCardActions, ImageTask } from './types.js'
import styles from './image-creator.module.css'

export interface ImageGridProps extends ImageCardActions { tasks: ImageTask[]; className?: string }

export default function ImageGrid({ tasks, className = '', ...actions }: ImageGridProps) {
  const visible = tasks.filter((task) => Boolean(task.output_url))
  if (!visible.length) return null
  return <div className={`${styles['image-creator-grid']} ${className}`}>{visible.map((task) => <ImageCard key={task.id} task={task} {...actions} />)}</div>
}
