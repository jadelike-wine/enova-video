'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TaskItem {
  id: string | number
  _optimistic?: boolean
  [key: string]: any
}

function isServerTask(task: TaskItem): boolean {
  return task && !task._optimistic && !String(task.id).startsWith('temp-')
}

/**
 * 新架构任务历史 hook。
 *
 * 后端 /api/v1/generations 返回单一（非分页）Generation[]，因此这里在
 * 加载时整表拉取一次，不再做 offset 分页。对外保留与原 hook 相同的
 * 返回结构（history / historyLoading / historyHasMore / resetHistory /
 * loadMoreHistory / setHistory），方便视图层无感切换。
 */
export function usePaginatedTaskHistory(listTasksFn: () => Promise<TaskItem[]>) {
  const [history, setHistory] = useState<TaskItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const historyRef = useRef<TaskItem[]>([])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  const loadHistory = useCallback(
    async (reset: boolean) => {
      setHistoryLoading(true)
      try {
        const tasks = await listTasksFn()
        if (reset) {
          // 保留乐观任务（临时生成的未持久化项）
          const pending = historyRef.current.filter((t) => !isServerTask(t))
          setHistory([...pending, ...tasks])
        } else {
          const existingIds = new Set(historyRef.current.map((t) => t.id))
          setHistory([
            ...historyRef.current,
            ...tasks.filter((t) => !existingIds.has(t.id)),
          ])
        }
        setHistoryHasMore(false)
      } finally {
        setHistoryLoading(false)
      }
    },
    [listTasksFn],
  )

  const loadMoreHistory = useCallback(() => loadHistory(false), [loadHistory])

  const resetHistory = useCallback(async () => {
    setHistoryHasMore(false)
    await loadHistory(true)
  }, [loadHistory])

  return {
    history,
    historyLoading,
    historyHasMore,
    resetHistory,
    loadMoreHistory,
    setHistory,
  }
}