'use client'

import { CloseOutlined, EditOutlined, MenuOutlined, PictureOutlined } from '@ant-design/icons'
import { useState } from 'react'

type WorkspaceTask = { id: string | number; title: string; status?: string }

export default function GenerationWorkspaceChrome({
  onNewConversation,
  tasks,
  onSelectTask,
  selectedTaskId,
}: {
  mode: 'image' | 'video'
  tasks?: WorkspaceTask[]
  onNewConversation?: () => void
  onSelectTask?: (id: string | number) => void
  selectedTaskId?: string | number | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`generation-chrome ${open ? 'is-open' : ''}`}>
      <button type="button" className="generation-new-chat" onClick={() => onNewConversation?.()}>
        <EditOutlined /> <span>新对话</span>
      </button>
      <button type="button" className="generation-expand-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? '收起历史对话' : '展开历史对话'}>
        <MenuOutlined />
      </button>
      {open && <aside className="generation-history-panel" aria-label="历史对话">
        <header><span>历史对话</span><button type="button" onClick={() => setOpen(false)} aria-label="关闭"><CloseOutlined /></button></header>
        <button type="button" className="generation-history-new" onClick={() => { onNewConversation?.(); setOpen(false) }}><EditOutlined /> 新对话</button>
        <div className="generation-history-list">
          {!tasks?.length && <p className="generation-history-empty">暂无历史对话</p>}
          {tasks?.map((task) => <button type="button" aria-current={task.id === selectedTaskId ? 'true' : undefined} className={`generation-history-item ${task.id === selectedTaskId ? 'is-selected' : ''}`} key={task.id} onClick={() => { onSelectTask?.(task.id); setOpen(false) }}>
            <PictureOutlined />
            <span><strong>{task.title}</strong><small>{task.status || '已完成'}</small></span>
          </button>)}
        </div>
      </aside>}
    </div>
  )
}
