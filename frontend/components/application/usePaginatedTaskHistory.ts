'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const TASK_HISTORY_PAGE_SIZE = 20

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TaskItem {
  id: number | string
  _optimistic?: boolean
  [key: string]: any
}

function isServerTask(task: TaskItem): boolean {
  return task && !task._optimistic && !String(task.id).startsWith('temp-')
}

export function usePaginatedTaskHistory(
  listTasksFn: (params: { limit: number; offset: number }) => Promise<TaskItem[]>,
) {
  const [history, setHistory] = useState<TaskItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyHasMore, setHistoryHasMore] = useState(true)
  const historyRef = useRef<TaskItem[]>([])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  function serverTaskCount(): number {
    return historyRef.current.filter(isServerTask).length
  }

  const loadHistory = useCallback(
    async (reset: boolean) => {
      setHistoryLoading(true)
      try {
        const offset = reset ? 0 : serverTaskCount()
        const tasks = await listTasksFn({
          limit: TASK_HISTORY_PAGE_SIZE,
          offset,
        })

        if (reset) {
          const pending = historyRef.current.filter((t) => !isServerTask(t))
          setHistory([...pending, ...tasks])
        } else {
          const existingIds = new Set(historyRef.current.map((t) => t.id))
          const merged = [...historyRef.current]
          for (const task of tasks) {
            if (!existingIds.has(task.id)) merged.push(task)
          }
          setHistory(merged)
        }

        setHistoryHasMore(tasks.length === TASK_HISTORY_PAGE_SIZE)
      } finally {
        setHistoryLoading(false)
      }
    },
    [listTasksFn],
  )

  const loadMoreHistory = useCallback(() => loadHistory(false), [loadHistory])

  const resetHistory = useCallback(async () => {
    setHistoryHasMore(true)
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