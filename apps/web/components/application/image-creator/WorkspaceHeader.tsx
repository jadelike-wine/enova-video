'use client'

import { DownOutlined, MenuOutlined } from '@ant-design/icons'
import { useTranslations } from 'next-intl'
import { conversationTitle } from './workbench'
import type { ImageTask } from './types'
import styles from './image-creator.module.css'

export interface WorkspaceHeaderProps {
  task: ImageTask | null
  conversationOpen: boolean
  onToggleConversation: () => void
}

export default function WorkspaceHeader({ task, conversationOpen, onToggleConversation }: WorkspaceHeaderProps) {
  const t = useTranslations('image')
  const title = conversationTitle(task, t('workbench.promptFallback'))

  return <header className={styles['image-creator-workspace-header']}>
    <div className={styles['image-creator-workspace-header__topline']}>
      <button
        type="button"
        className={styles['image-creator-workspace-header__conversation-trigger']}
        onClick={onToggleConversation}
        aria-expanded={conversationOpen}
        aria-label={conversationOpen ? t('workbench.closeConversation') : t('workbench.openConversation')}
      >
        <MenuOutlined />
        <span>{title}</span>
        <DownOutlined className={conversationOpen ? styles['is-open'] : ''} />
      </button>
      <span className={styles['image-creator-workspace-header__mode']}>{task ? t('result') : t('title')}</span>
    </div>
  </header>
}
