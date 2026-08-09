'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { videoApi } from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useApiKeyGuard, videoModeNeedsQiniu } from './useApiKeyGuard'
import { usePaginatedTaskHistory, type TaskItem } from './usePaginatedTaskHistory'
import { formatErrorMessage } from '../../lib/errorMessage'
import { canRefreshTaskStatus } from '../../lib/transientError'
import TrashIcon from './TrashIcon'

interface VideoMeta {
  models: { id: string; name: string }[]
  modes: { id: string; name: string }[]
  frame_presets: { label: string; num_frames: number; frame_rate: number }[]
  resolution_presets: {
    id: string
    group: string
    label: string
    width: number
    height: number
  }[]
}

interface VideoTask extends TaskItem {
  id: number | string
  status: string
  progress?: number
  prompt?: string
  negative_prompt?: string
  mode?: string
  model?: string
  width?: number
  height?: number
  num_frames?: number
  frame_rate?: number
  seed?: number | string | null
  input_images?: string | string[]
  output_url?: string
  qiniu_url?: string
  video_id?: unknown
  task_id?: unknown
  error_message?: unknown
  seconds?: number
  size?: string
  completed_at?: string
  created_at?: string
}

interface VideoForm {
  model: string
  mode: string
  prompt: string
  negative_prompt: string
  width: number
  height: number
  num_frames: number
  frame_rate: number
  seed: number | null
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    submitting: '提交中',
    queued: '排队中',
    in_progress: '生成中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] || status
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    submitting: 'badge-progress',
    queued: 'badge-queued',
    in_progress: 'badge-progress',
    completed: 'badge-completed',
    failed: 'badge-failed',
  }
  return map[status] || 'badge'
}

function modeTagClass(mode?: string): string {
  const map: Record<string, string> = {
    text2video: 'bg-cyan-400/15 text-cyan-200 border-cyan-400/25',
    img2video: 'bg-violet-400/15 text-violet-200 border-violet-400/25',
    multi_img: 'bg-orange-400/15 text-orange-200 border-orange-400/25',
    keyframes: 'bg-pink-400/15 text-pink-200 border-pink-400/25',
  }
  return map[mode || ''] || 'bg-white/10 text-white/60 border-white/15'
}

function displayUrl(task: VideoTask): string {
  return task?.qiniu_url || task?.output_url || ''
}

function inputImagesOf(task: VideoTask): string[] {
  if (!task?.input_images) return []
  if (Array.isArray(task.input_images)) return task.input_images
  try {
    const parsed = JSON.parse(task.input_images)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatResolution(task: VideoTask): string {
  if (!task?.width || !task?.height) return '—'
  return `${task.width}×${task.height}`
}

function formatDuration(task: VideoTask): string {
  if (!task?.num_frames || !task?.frame_rate) return '—'
  return `${(task.num_frames / task.frame_rate).toFixed(1)}s`
}

function formatTaskMeta(task: VideoTask): string {
  const parts = [
    formatResolution(task),
    formatDuration(task),
    task.num_frames != null ? `${task.num_frames}帧` : null,
    task.frame_rate != null ? `${task.frame_rate}fps` : null,
    task.seed != null && task.seed !== '' ? `seed:${task.seed}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

export default function VideoView() {
  const { confirm, alert } = useDialog()
  const {
    hasActiveKey,
    hasQiniuConfig,
    keyStatusLoading,
    refreshKeyStatus,
    requireApiKey,
    requireQiniuConfig,
  } = useApiKeyGuard()

  const [meta, setMeta] = useState<VideoMeta>({
    models: [],
    modes: [],
    frame_presets: [],
    resolution_presets: [],
  })
  const [form, setForm] = useState<VideoForm>({
    model: 'agnes-video-v2.0',
    mode: 'text2video',
    prompt: '',
    negative_prompt: '',
    width: 1280,
    height: 720,
    num_frames: 121,
    frame_rate: 24,
    seed: null,
  })
  const [inputImages, setInputImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [refreshingTaskId, setRefreshingTaskId] = useState<number | string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | string | null>(null)
  const [error, setError] = useState('')

  const { history, historyLoading, historyHasMore, resetHistory, loadMoreHistory, setHistory } =
    usePaginatedTaskHistory((params) => videoApi.listTasks(params) as Promise<TaskItem[]>)

  const formCardRef = useRef<HTMLDivElement>(null)
  const historyScrollRef = useRef<HTMLDivElement>(null)
  const historySentinelRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<TaskItem[]>(history)
  useEffect(() => {
    historyRef.current = history
  }, [history])
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingRef = useRef(false)
  const selectedTaskRef = useRef<number | string | null>(selectedTaskId)
  useEffect(() => {
    selectedTaskRef.current = selectedTaskId
  }, [selectedTaskId])
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const currentModeNeedsQiniu = videoModeNeedsQiniu(form.mode)

  const selectedTask: VideoTask | null =
  (history.find((t) => t.id === selectedTaskId) as VideoTask | undefined) || null

  const activeTasks = history.filter((t) =>
    ['queued', 'in_progress', 'submitting'].includes(t.status),
  )

  const selectedResolutionId = (() => {
    const match = meta.resolution_presets.find(
      (p) => p.width === form.width && p.height === form.height,
    )
    return match?.id || '720p-h'
  })()

  const resolutionGroups = [
    { label: '横屏', items: meta.resolution_presets.filter((p) => p.group === 'landscape') },
    { label: '竖屏', items: meta.resolution_presets.filter((p) => p.group === 'portrait') },
  ].filter((g) => g.items.length)

  const taskErrorMessage = useCallback(
    (task: VideoTask) =>
      formatErrorMessage(task?.error_message) || (task?.status === 'failed' ? '生成失败' : ''),
    [],
  )

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const pendingTasks = useCallback(
    () =>
      historyRef.current.filter(
        (t) =>
          ['queued', 'in_progress', 'submitting'].includes(t.status) &&
          !String(t.id).startsWith('temp-'),
      ),
    [],
  )

  const pollTickRef = useRef<() => Promise<void>>(async () => {})

  const schedulePoll = useCallback(() => {
    if (!mountedRef.current) return
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = setTimeout(() => {
      void pollTickRef.current()
    }, 8000)
  }, [])

  const pollTick = useCallback(async () => {
    if (pollingRef.current || !mountedRef.current) return
    pollingRef.current = true
    try {
      const pending = pendingTasks()
      if (!pending.length) {
        stopPolling()
        return
      }
      for (const task of pending) {
        try {
          const prevStatus = task.status
          const updated = (await videoApi.getTask(task.id as number)) as VideoTask
          const idx = historyRef.current.findIndex((t) => t.id === updated.id)
          if (idx !== -1) {
            setHistory((prev) => {
              const next = [...prev]
              next[idx] = updated
              return next
            })
          }
          if (prevStatus !== 'failed' && updated.status === 'failed') {
            const msg = taskErrorMessage(updated) || '生成失败'
            if (selectedTaskRef.current === updated.id) {
              setError(msg)
            }
            await alert({ title: '生成失败', message: msg, confirmVariant: 'danger' })
          }
        } catch {
          /* ignore transient polling errors */
        }
      }
    } finally {
      pollingRef.current = false
    }
    if (mountedRef.current && pendingTasks().length) {
      schedulePoll()
    } else {
      stopPolling()
    }
  }, [pendingTasks, stopPolling, schedulePoll, setHistory, alert, taskErrorMessage])

  useEffect(() => {
    pollTickRef.current = pollTick
  }, [pollTick])

  const startPollingAll = useCallback(() => {
    stopPolling()
    if (pollingRef.current) return
    // Schedule a single tick regardless of current pending count; pollTick
    // self-stops if no pending tasks remain. This avoids a stale read of
    // historyRef right after an async reset.
    schedulePoll()
  }, [stopPolling, schedulePoll])

  const loadMeta = useCallback(async () => {
    const data = (await videoApi.getModels()) as VideoMeta
    setMeta(data)
    await resetHistory()
    if (historyRef.current.length && !selectedTaskId) {
      setSelectedTaskId(historyRef.current[0].id)
    }
    startPollingAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetHistory, startPollingAll])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (!(await requireQiniuConfig())) {
      e.target.value = ''
      return
    }
    setUploading(true)
    try {
      for (const file of files) {
        const res = (await videoApi.upload(file)) as { url: string }
        setInputImages((prev) => [...prev, res.url])
      }
    } catch (err) {
      setError((err as Error).message)
      await alert({
        title: '上传失败',
        message: (err as Error).message,
        confirmVariant: 'danger',
      })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const removeImage = (i: number) => {
    setInputImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  const selectMode = (modeId: string) => {
    setForm((prev) => ({ ...prev, mode: modeId }))
  }

  const applyPreset = (preset: { num_frames: number; frame_rate: number }) => {
    setForm((prev) => ({ ...prev, num_frames: preset.num_frames, frame_rate: preset.frame_rate }))
  }

  const generate = useCallback(async () => {
    if (!form.prompt.trim()) {
      setError('请输入提示词')
      return
    }
    if (form.mode === 'img2video' && !inputImages.length) {
      setError('请上传输入图片')
      return
    }
    if (['multi_img', 'keyframes'].includes(form.mode) && inputImages.length < 2) {
      setError('至少需要 2 张图片')
      return
    }
    if (!(await requireApiKey())) return
    if (currentModeNeedsQiniu && !(await requireQiniuConfig())) return

    setError('')
    setSubmitting(true)

    const tempId = `temp-${Date.now()}`
    const optimisticInputImages =
      form.mode === 'img2video' && inputImages.length
        ? [inputImages[0]]
        : ['multi_img', 'keyframes'].includes(form.mode) && inputImages.length
          ? [...inputImages]
          : undefined

    const optimisticTask: VideoTask = {
      id: tempId,
      status: 'submitting',
      progress: 0,
      prompt: form.prompt,
      negative_prompt: form.negative_prompt || undefined,
      mode: form.mode,
      width: form.width,
      height: form.height,
      num_frames: form.num_frames,
      frame_rate: form.frame_rate,
      seed: form.seed,
      input_images: optimisticInputImages,
      created_at: new Date().toISOString(),
      _optimistic: true,
    }

    setHistory([optimisticTask, ...history])
    setSelectedTaskId(tempId)

    try {
      const payload: Record<string, unknown> = { ...form }
      if (form.mode === 'img2video') {
        payload.image = inputImages[0]
      } else if (['multi_img', 'keyframes'].includes(form.mode)) {
        payload.images = inputImages
      }
      if (!payload.seed) delete payload.seed

      const task = (await videoApi.generate(payload)) as VideoTask

      setHistory((prev) => {
        const idx = prev.findIndex((t) => t.id === tempId)
        if (idx !== -1) {
          const next = [...prev]
          next[idx] = task
          return next
        }
        return [task, ...prev]
      })
      setSelectedTaskId(task.id)
      startPollingAll()
      if (task.status === 'failed') {
        const msg = taskErrorMessage(task) || '提交失败'
        setError(msg)
      }
    } catch (err) {
      try {
        await resetHistory()
        if (historyRef.current.length) {
          setSelectedTaskId(historyRef.current[0].id)
        }
      } catch {
        /* ignore */
      }
      setError((err as Error).message)
      await alert({ title: '提交失败', message: (err as Error).message, confirmVariant: 'danger' })
    } finally {
      setSubmitting(false)
    }
  }, [
    form,
    inputImages,
    currentModeNeedsQiniu,
    requireApiKey,
    requireQiniuConfig,
    history,
    setHistory,
    startPollingAll,
    resetHistory,
    alert,
    taskErrorMessage,
  ])

  const refreshTaskStatus = useCallback(
    async (task: VideoTask) => {
      if (!task?.id || task._optimistic || refreshingTaskId) return
      setRefreshingTaskId(task.id)
      setError('')

      const idx = historyRef.current.findIndex((t) => t.id === task.id)
      if (idx !== -1 && task.video_id) {
        setHistory((prev) => {
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            error_message: null,
            status: ['failed'].includes(task.status) ? 'in_progress' : next[idx].status,
          }
          return next
        })
      }

      try {
        const updated = (await videoApi.syncTask(task.id as number)) as VideoTask
        setHistory((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t)),
        )
        setSelectedTaskId(updated.id)
        if (updated.status !== 'failed' && updated.status !== 'completed') {
          startPollingAll()
        } else if (updated.status === 'failed') {
          await alert({
            title: '仍未完成',
            message: taskErrorMessage(updated) || '任务尚未完成，请稍后再试',
            confirmVariant: 'danger',
          })
        }
      } catch (err) {
        setError((err as Error).message)
        await alert({ title: '刷新失败', message: (err as Error).message, confirmVariant: 'danger' })
        try {
          const latest = (await videoApi.getTask(task.id as number)) as VideoTask
          setHistory((prev) => prev.map((t) => (t.id === task.id ? latest : t)))
        } catch {
          /* ignore */
        }
      } finally {
        setRefreshingTaskId(null)
      }
    },
    [refreshingTaskId, alert, setHistory, startPollingAll, taskErrorMessage],
  )

  const retryTask = useCallback(
    async (task: VideoTask) => {
      if (!task?.id || task._optimistic || retrying) return
      if (!(await requireApiKey())) return
      setRetrying(true)
      setError('')

      setHistory((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: 'submitting',
                progress: 0,
                error_message: null,
                task_id: null,
                video_id: null,
                output_url: null,
                qiniu_url: null,
                seconds: null,
                size: null,
                completed_at: null,
              }
            : t,
        ),
      )

      try {
        const updated = (await videoApi.retry(task.id as number)) as VideoTask
        setHistory((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
        setSelectedTaskId(updated.id)
        if (updated.status !== 'failed') {
          startPollingAll()
        } else {
          const msg = taskErrorMessage(updated) || '提交失败'
          await alert({ title: '重试失败', message: msg, confirmVariant: 'danger' })
        }
      } catch (err) {
        setError((err as Error).message)
        await alert({ title: '重试失败', message: (err as Error).message, confirmVariant: 'danger' })
        try {
          const latest = (await videoApi.getTask(task.id as number)) as VideoTask
          setHistory((prev) => prev.map((t) => (t.id === task.id ? latest : t)))
        } catch {
          /* ignore */
        }
      } finally {
        setRetrying(false)
      }
    },
    [retrying, requireApiKey, alert, setHistory, startPollingAll, taskErrorMessage],
  )

  const deleteTask = useCallback(
    async (task: VideoTask, e?: React.MouseEvent) => {
      e?.stopPropagation()
      if (task._optimistic) return
      const ok = await confirm({
        title: '删除任务',
        message: '确定删除此视频任务？删除后无法恢复。',
        confirmText: '删除',
        cancelText: '取消',
        confirmVariant: 'danger',
      })
      if (!ok) return
      try {
        await videoApi.deleteTask(task.id as number)
        setHistory((prev) => prev.filter((t) => t.id !== task.id))
        if (selectedTaskId === task.id) {
          setSelectedTaskId(historyRef.current[0]?.id || null)
        }
      } catch (err) {
        await alert({ title: '删除失败', message: (err as Error).message, confirmVariant: 'danger' })
      }
    },
    [confirm, selectedTaskId, setHistory, alert],
  )

  const selectTask = (task: TaskItem) => setSelectedTaskId(task.id)

  const fillFormFromTask = (task: VideoTask) => {
    if (!task) return
    setForm({
      model: task.model || 'agnes-video-v2.0',
      mode: task.mode || 'text2video',
      prompt: task.prompt || '',
      negative_prompt: task.negative_prompt || '',
      width: task.width ?? 1280,
      height: task.height ?? 720,
      num_frames: task.num_frames ?? 121,
      frame_rate: task.frame_rate ?? 24,
      seed: (task.seed ?? null) as number | null,
    })
    setInputImages([...inputImagesOf(task)])
    setError('')
    formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // History infinite scroll observer
  useEffect(() => {
    if (!historyScrollRef.current || !historySentinelRef.current || !historyHasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreHistory()
      },
      { root: historyScrollRef.current, rootMargin: '120px' },
    )
    observer.observe(historySentinelRef.current)
    return () => observer.disconnect()
  }, [historyHasMore, loadMoreHistory])

  // Initial load
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refreshKeyStatus()
      if (cancelled) return
      await loadMeta()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  return (
    <div className="flex h-full">
      {/* Task list sidebar */}
      <div className="w-96 border-r border-white/10 flex flex-col bg-black/10">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-white">任务列表</h3>
            {activeTasks.length > 0 && (
              <span className="badge-progress">{activeTasks.length} 进行中</span>
            )}
          </div>
          <p className="text-xs text-white/40">提交后立即显示进度</p>
        </div>

        <div ref={historyScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
          {history.map((rawTask) => {
            const task = rawTask as VideoTask
            const isSelected = selectedTaskId === task.id
            return (
              <div
                key={String(task.id)}
                onClick={() => selectTask(task)}
                className={`group p-4 rounded-2xl cursor-pointer transition-all duration-200 border ${
                  isSelected
                    ? 'bg-gradient-to-r from-fuchsia-500/20 to-cyan-400/10 border-white/25 shadow-glow-cyan'
                    : 'border-white/15 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs text-white/40 font-mono">
                        #{task._optimistic ? '...' : task.id}
                      </span>
                      <span className={statusBadgeClass(task.status)}>{statusLabel(task.status)}</span>
                    </div>
                    <p className="text-sm text-white/90 truncate font-medium">{task.prompt}</p>
                    {task.negative_prompt && (
                      <p className="text-xs text-white/40 truncate mt-0.5">
                        负向: {task.negative_prompt}
                      </p>
                    )}
                    <p className="text-[11px] text-white/35 mt-1 font-mono">{formatTaskMeta(task)}</p>
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${modeTagClass(
                          task.mode,
                        )}`}
                      >
                        {meta.modes.find((m) => m.id === task.mode)?.name || task.mode}
                      </span>
                    </div>

                    {inputImagesOf(task).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {inputImagesOf(task).map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={inputImagesOf(task).length > 1 ? `参考图 ${i + 1}` : '参考图'}
                            className="w-10 h-10 object-cover rounded-lg border border-white/15"
                          />
                        ))}
                      </div>
                    )}

                    {['submitting', 'queued', 'in_progress'].includes(task.status) && (
                      <div className="mt-3">
                        <div className="progress-bar">
                          <div
                            className={`progress-fill ${task.status === 'submitting' ? 'animate-pulse' : ''}`}
                            style={{
                              width:
                                task.status === 'submitting' ? '15%' : `${task.progress || 5}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-white/40 mt-1.5">
                          {task.status === 'submitting'
                            ? '正在提交任务...'
                            : task.status === 'queued'
                              ? '排队等待中...'
                              : `进度 ${task.progress || 0}%`}
                        </p>
                      </div>
                    )}

                    {task.status === 'failed' && (
                      <p className="text-xs text-rose-300/80 mt-2 truncate">{taskErrorMessage(task)}</p>
                    )}
                    {canRefreshTaskStatus(task, 'video') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          refreshTaskStatus(task)
                        }}
                        disabled={refreshingTaskId === task.id}
                        className="mt-2 text-xs px-2.5 py-1 rounded-lg border border-cyan-400/30 text-cyan-200 hover:bg-cyan-400/10 transition-colors disabled:opacity-50"
                      >
                        {refreshingTaskId === task.id ? '刷新中...' : '刷新状态'}
                      </button>
                    )}
                  </div>

                  <button
                    onClick={(e) => deleteTask(task, e)}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center text-white/50 hover:bg-rose-500/30 hover:text-rose-300 transition-all flex-shrink-0 self-start mt-0.5 ${
                      task._optimistic
                        ? 'invisible pointer-events-none'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                    title="删除"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            )
          })}

          {historyHasMore && history.length > 0 && (
            <div ref={historySentinelRef} className="py-3 flex justify-center">
              {historyLoading && (
                <div className="w-5 h-5 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
              )}
            </div>
          )}

          {!history.length && historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-white/40">
              <div className="w-6 h-6 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
              <p className="text-xs mt-3">加载中...</p>
            </div>
          )}

          {!history.length && !historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-white/40">
              <div className="text-4xl mb-3">🎬</div>
              <p className="text-sm">暂无任务</p>
              <p className="text-xs mt-1">填写参数后点击生成</p>
            </div>
          )}
        </div>
      </div>

      {/* Main area: form + preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            <div>
              <h2 className="text-2xl font-extrabold bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-orange-300 bg-clip-text text-transparent">
                视频生成
              </h2>
              <p className="text-white/50 text-sm mt-1">文生视频 · 图生视频 · 多图视频 · 关键帧动画</p>
            </div>

            {!keyStatusLoading && !hasActiveKey && (
              <div className="glass-card border border-amber-400/30 bg-amber-400/10 py-3 px-4">
                <p className="text-sm text-amber-100/90">
                  尚未配置 Agnes AI API Key，无法生成视频。请前往
                  <Link href="/app/settings" className="text-cyan-300 hover:underline">
                    {' '}设置
                  </Link>
                  添加并启用 Key。
                </p>
              </div>
            )}

            {!keyStatusLoading && !hasQiniuConfig && (
              <div className="glass-card border border-sky-400/25 bg-sky-400/10 py-3 px-4">
                <p className="text-sm text-sky-100/90">
                  未配置七牛云对象存储：当前可使用
                  <strong className="font-semibold text-white/90">文生视频</strong>
                  ；图生视频、多图视频、关键帧动画需上传参考图，暂不可用。生成结果使用 Agnes
                  临时链接，可能无法长期访问。
                  <Link href="/app/settings#storage" className="text-cyan-300 hover:underline ml-1">
                    查看配置说明
                  </Link>
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Form */}
              <div ref={formCardRef} className="glass-card space-y-4">
                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">生成模式</label>
                  <div className="grid grid-cols-2 gap-2">
                    {meta.modes.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => selectMode(m.id)}
                        className={`px-3 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200 border ${
                          form.mode === m.id
                            ? 'border-fuchsia-400/50 bg-gradient-to-r from-fuchsia-500/25 to-cyan-400/15 text-white shadow-glow-cyan'
                            : 'border-white/10 text-white/50 hover:border-white/25 hover:bg-white/5'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                  {!keyStatusLoading && !hasQiniuConfig && currentModeNeedsQiniu && (
                    <p className="text-xs text-amber-200/90 mt-2 glass px-3 py-2 rounded-xl border border-amber-400/25">
                      此模式需上传参考图，请先配置七牛云对象存储。
                      <Link href="/app/settings#storage" className="text-cyan-300 hover:underline">
                        {' '}查看说明
                      </Link>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">提示词</label>
                  <textarea
                    value={form.prompt}
                    onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
                    rows={3}
                    className="input-field text-sm"
                    placeholder="描述视频内容、动作、镜头运动..."
                  />
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">
                    负向提示词（可选）
                  </label>
                  <input
                    value={form.negative_prompt}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, negative_prompt: e.target.value }))
                    }
                    className="input-field text-sm"
                    placeholder="描述需要避免的内容"
                  />
                </div>

                {form.mode !== 'text2video' && (
                  <div>
                    <label className="text-sm text-white/60 mb-2 block font-medium">
                      {form.mode === 'img2video' ? '输入图片' : '参考图片'}
                    </label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {inputImages.map((url, i) => (
                        <div key={i} className="relative group">
                          <img
                            src={url}
                            alt="参考图"
                            className="w-20 h-20 object-cover rounded-2xl border border-white/20"
                          />
                          <button
                            onClick={() => removeImage(i)}
                            className="absolute -top-1 -right-1 w-6 h-6 bg-rose-500 rounded-full text-xs opacity-0 group-hover:opacity-100 shadow-lg"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <label
                      className={`btn-secondary inline-flex items-center gap-2 text-sm ${
                        !hasQiniuConfig
                          ? 'opacity-50 cursor-not-allowed pointer-events-none'
                          : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleUpload}
                      />
                      {uploading ? '上传中...' : '+ 上传图片'}
                    </label>
                  </div>
                )}

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">分辨率</label>
                  <select
                    value={selectedResolutionId}
                    onChange={(e) => {
                      const preset = meta.resolution_presets.find((p) => p.id === e.target.value)
                      if (preset) {
                        setForm((prev) => ({
                          ...prev,
                          width: preset.width,
                          height: preset.height,
                        }))
                      }
                    }}
                    className="select-field text-sm w-full"
                  >
                    {resolutionGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">视频时长</label>
                  <div className="flex flex-wrap gap-2">
                    {meta.frame_presets.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => applyPreset(p)}
                        className={`px-4 py-1.5 rounded-full text-xs border transition-all duration-200 ${
                          form.num_frames === p.num_frames
                            ? 'border-fuchsia-400/50 text-fuchsia-200 bg-fuchsia-500/20'
                            : 'border-white/15 text-white/50 hover:border-white/30'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-white/60 mb-2 block">帧数</label>
                    <input
                      value={form.num_frames}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          num_frames: Number(e.target.value),
                        }))
                      }
                      type="number"
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-white/60 mb-2 block">帧率</label>
                    <input
                      value={form.frame_rate}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          frame_rate: Number(e.target.value),
                        }))
                      }
                      type="number"
                      className="input-field text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block">随机种子（可选）</label>
                  <input
                    value={form.seed ?? ''}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        seed: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    type="number"
                    className="input-field text-sm"
                    placeholder="留空则随机"
                  />
                </div>

                {error && (
                  <p className="text-rose-300 text-sm glass px-4 py-2 rounded-2xl border border-rose-400/30">
                    {error}
                  </p>
                )}

                <button onClick={generate} disabled={submitting} className="btn-primary w-full py-3 text-base">
                  {submitting ? '提交中...' : '✨ 开始生成'}
                </button>
              </div>

              {/* Preview */}
              <div className="glass-card flex flex-col min-h-[420px]">
                {selectedTask ? (
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-bold text-white">
                        {selectedTask._optimistic ? '新任务' : `任务 #${selectedTask.id}`}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={statusBadgeClass(selectedTask.status)}>
                          {statusLabel(selectedTask.status)}
                        </span>
                        {!selectedTask._optimistic && (
                          <button
                            onClick={() => deleteTask(selectedTask)}
                            className="btn-ghost text-rose-300 hover:bg-rose-500/20 hover:text-rose-200 text-xs px-3 py-1.5"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>

                    {['submitting', 'queued', 'in_progress'].includes(selectedTask.status) && (
                      <div className="mb-5">
                        <div className="progress-bar h-3">
                          <div
                            className={`progress-fill ${
                              selectedTask.status === 'submitting' ? 'animate-pulse' : ''
                            }`}
                            style={{
                              width:
                                selectedTask.status === 'submitting'
                                  ? '15%'
                                  : `${selectedTask.progress || 5}%`,
                            }}
                          />
                        </div>
                        <p className="text-sm text-white/50 mt-2">
                          {selectedTask.status === 'submitting'
                            ? '正在提交到服务器...'
                            : selectedTask.status === 'queued'
                              ? '任务已排队，等待处理...'
                              : `生成进度 ${selectedTask.progress || 0}%，请耐心等待`}
                        </p>
                      </div>
                    )}

                    {displayUrl(selectedTask) ? (
                      <div className="flex-1">
                        <video
                          src={displayUrl(selectedTask)}
                          controls
                          className="w-full rounded-2xl border border-white/15 shadow-glow"
                        />
                        <div className="mt-3 text-xs text-white/50 flex flex-wrap gap-4">
                          {selectedTask.seconds && <span>时长: {selectedTask.seconds}s</span>}
                          {selectedTask.size && <span>分辨率: {selectedTask.size}</span>}
                          {selectedTask.qiniu_url && (
                            <span className="text-emerald-300">✓ 已存储至七牛云</span>
                          )}
                        </div>
                        {inputImagesOf(selectedTask).length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-white/50 mb-2 font-medium">参考图</p>
                            <div className="flex flex-wrap gap-2">
                              {inputImagesOf(selectedTask).map((url, i) => (
                                <img
                                  key={i}
                                  src={url}
                                  alt="参考图"
                                  className="w-20 h-20 object-cover rounded-xl border border-white/20"
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : ['submitting', 'queued', 'in_progress'].includes(selectedTask.status) ? (
                      <div className="flex-1 flex flex-col">
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <div className="w-16 h-16 rounded-full border-4 border-fuchsia-400/30 border-t-fuchsia-400 animate-spin" />
                          <p className="text-white/50 mt-5 text-sm">视频生成中，可能需要数分钟</p>
                          {canRefreshTaskStatus(selectedTask, 'video') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                refreshTaskStatus(selectedTask)
                              }}
                              disabled={refreshingTaskId === selectedTask.id}
                              className="mt-4 btn-secondary text-xs px-4 py-2"
                            >
                              {refreshingTaskId === selectedTask.id ? '刷新中...' : '手动刷新状态'}
                            </button>
                          )}
                        </div>
                        {inputImagesOf(selectedTask).length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-white/50 mb-2 font-medium">参考图</p>
                            <div className="flex flex-wrap gap-2">
                              {inputImagesOf(selectedTask).map((url, i) => (
                                <img
                                  key={i}
                                  src={url}
                                  alt="参考图"
                                  className="w-20 h-20 object-cover rounded-xl border border-white/20"
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {selectedTask.status === 'failed' && (
                      <div className="glass px-4 py-3 rounded-2xl border border-rose-400/30 mt-2">
                        <p className="text-rose-300 text-sm whitespace-pre-wrap break-words">
                          {taskErrorMessage(selectedTask)}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canRefreshTaskStatus(selectedTask, 'video') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                refreshTaskStatus(selectedTask)
                              }}
                              disabled={refreshingTaskId === selectedTask.id}
                              className="btn-primary px-4 py-2 text-sm"
                            >
                              {refreshingTaskId === selectedTask.id ? '刷新中...' : '手动刷新状态'}
                            </button>
                          )}
                          {!selectedTask._optimistic && !selectedTask.video_id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                retryTask(selectedTask)
                              }}
                              disabled={retrying}
                              className="btn-secondary px-4 py-2 text-sm"
                            >
                              {retrying ? '提交中...' : '重试提交'}
                            </button>
                          )}
                        </div>
                        {canRefreshTaskStatus(selectedTask, 'video') && (
                          <p className="text-xs text-white/40 mt-2">
                            若因限流导致状态未更新，可点击刷新从服务器同步最新结果
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-white/50 font-medium">生成参数</p>
                        {!selectedTask._optimistic && (
                          <button
                            onClick={() => fillFormFromTask(selectedTask)}
                            className="btn-secondary text-xs px-3 py-1.5"
                          >
                            填充到表单
                          </button>
                        )}
                      </div>
                      <div className="glass px-4 py-3 rounded-2xl border border-white/10 space-y-2 text-sm">
                        <div>
                          <span className="text-white/40 text-xs">正向提示词</span>
                          <p className="text-white/80 mt-0.5 leading-relaxed">
                            {selectedTask.prompt || '—'}
                          </p>
                        </div>
                        {selectedTask.negative_prompt && (
                          <div>
                            <span className="text-white/40 text-xs">负向提示词</span>
                            <p className="text-white/60 mt-0.5 leading-relaxed">
                              {selectedTask.negative_prompt}
                            </p>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-1">
                          <div>
                            <span className="text-white/40">分辨率</span>{' '}
                            <span className="text-white/70">{formatResolution(selectedTask)}</span>
                          </div>
                          <div>
                            <span className="text-white/40">时长</span>{' '}
                            <span className="text-white/70">{formatDuration(selectedTask)}</span>
                          </div>
                          <div>
                            <span className="text-white/40">帧数</span>{' '}
                            <span className="text-white/70">{selectedTask.num_frames ?? '—'}</span>
                          </div>
                          <div>
                            <span className="text-white/40">帧率</span>{' '}
                            <span className="text-white/70">
                              {selectedTask.frame_rate != null
                                ? `${selectedTask.frame_rate} fps`
                                : '—'}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-white/40">随机种子</span>{' '}
                            <span className="text-white/70 font-mono">
                              {selectedTask.seed != null && selectedTask.seed !== ''
                                ? selectedTask.seed
                                : '随机'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-white/40">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-400/30 to-fuchsia-500/30 flex items-center justify-center text-4xl mb-4 border border-white/20 animate-float">
                      🎬
                    </div>
                    <p>选择左侧任务或创建新任务</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}