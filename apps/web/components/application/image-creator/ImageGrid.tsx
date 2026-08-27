'use client'

import ImageCard from './ImageCard'
import type { ImageTask } from './types'
import styles from './image-creator.module.css'

export interface ImageGridProps { tasks: ImageTask[]; className?: string }

export default function ImageGrid({ tasks, className = '' }: ImageGridProps) {
  const visible = tasks.filter((task) => Boolean(task.output_url))
  if (!visible.length) return null
  return <div className={`${styles['image-creator-grid']} ${className}`}>{visible.map((task) => <ImageCard key={task.id} task={task} />)}</div>
}
