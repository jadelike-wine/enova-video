'use client'

import { useTranslations } from 'next-intl'
import { taskMetadata } from './workbench'
import type { ImageTask } from './types'
import styles from './image-creator.module.css'

export interface WorkspaceHeaderProps {
  task: ImageTask | null
  conversationOpen: boolean
  onToggleConversation: () => void
}

function formatCreatedAt(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export default function WorkspaceHeader({ task }: WorkspaceHeaderProps) {
  const t = useTranslations('image')
  const title = task?.title?.trim() || '未命名对话'
  const metadata = taskMetadata(task)
  const createdAt = formatCreatedAt(task?.created_at)

  return <header className={styles['image-creator-workspace-header']}>
    <div className={styles['image-creator-workspace-header__topline']}>
      <span className={styles['image-creator-workspace-header__mode']}>{task ? t('result') : t('title')}</span>
    </div>
    {task?.prompt && <div className={styles['image-creator-workspace-header__context']}>
      <h1>{title}</h1>
      <p>{task.prompt}</p>
      <div className={styles['image-creator-workspace-header__metadata']}>
        {metadata.map((value) => <span key={value}>{value}</span>)}
        {createdAt && <span>{t('workbench.createdAt')} {createdAt}</span>}
      </div>
    </div>}
  </header>
}
