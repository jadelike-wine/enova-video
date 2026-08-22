'use client'

import { CloseOutlined, HistoryOutlined, LoadingOutlined, PlusOutlined, PictureOutlined } from '@ant-design/icons'
import { useTranslations } from 'next-intl'
import type { ImageTask } from './types'
import styles from './image-creator.module.css'

export interface ConversationPanelProps {
  open: boolean
  tasks: ImageTask[]
  selectedTaskId: string | number | null
  onClose: () => void
  onNewConversation: () => void
  onSelectTask: (task: ImageTask) => void
}

function TaskThumbnail({ task }: { task: ImageTask }) {
  if (task.output_url) {
    // Provider output URLs have unknown remote hosts, so keep native img behavior.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={task.output_url} alt="" className={styles['image-creator-conversation__thumbnail']} />
  }
  return <span className={styles['image-creator-conversation__status']} aria-hidden="true">
    {task.status === 'PENDING' || task.status === 'QUEUED' || task.status === 'RUNNING' ? <LoadingOutlined /> : <PictureOutlined />}
  </span>
}

export default function ConversationPanel({ open, tasks, selectedTaskId, onClose, onNewConversation, onSelectTask }: ConversationPanelProps) {
  const t = useTranslations('image')
  if (!open) return null

  return <>
    <button type="button" className={styles['image-creator-conversation__backdrop']} onClick={onClose} aria-label={t('workbench.closeConversation')} />
    <aside className={styles['image-creator-conversation']} aria-label={t('workbench.conversation')}>
      <header className={styles['image-creator-conversation__header']}>
        <div>
          <p className={styles['image-creator-conversation__eyebrow']}>{t('workbench.conversation')}</p>
          <h2>{t('workbench.recent')}</h2>
        </div>
        <button type="button" className={styles['image-creator-conversation__close']} onClick={onClose} aria-label={t('workbench.closeConversation')}>
          <CloseOutlined />
        </button>
      </header>
      <div className={styles['image-creator-conversation__actions']}>
        <button type="button" className={styles['image-creator-conversation__primary']} onClick={onNewConversation}>
          <PlusOutlined />
          {t('workbench.newConversation')}
        </button>
        <button type="button" className={styles['image-creator-conversation__default']} onClick={onNewConversation}>
          <HistoryOutlined />
          {t('workbench.defaultCreation')}
        </button>
      </div>
      <div className={styles['image-creator-conversation__section']}>
        <p className={styles['image-creator-conversation__label']}>{t('workbench.recent')}</p>
        {tasks.length === 0 ? <p className={styles['image-creator-conversation__empty']}>{t('workbench.empty')}</p> : <div className={styles['image-creator-conversation__list']}>
          {tasks.map((task) => <button
            type="button"
            key={task.id}
            aria-current={task.id === selectedTaskId ? 'true' : undefined}
            className={`${styles['image-creator-conversation__item']} ${task.id === selectedTaskId ? styles['is-selected'] : ''}`}
            onClick={() => onSelectTask(task)}
          >
            <TaskThumbnail task={task} />
            <span className={styles['image-creator-conversation__item-copy']}>
              <strong>{task.title?.trim() || '未命名对话'}</strong>
              <small>{task.status === 'SUCCEEDED' ? t('workbench.createdAt') : task.status}</small>
            </span>
          </button>)}
        </div>}
      </div>
    </aside>
  </>
}
