'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  generationApi,
  uploadApi,
  type Generation,
  type CreateGenerationPayload,
} from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useApiKeyGuard } from './useApiKeyGuard'
import { usePaginatedTaskHistory, type TaskItem } from './usePaginatedTaskHistory'
import { formatErrorMessage } from '../../lib/errorMessage'
import {
  VIDEO_MODELS,
  VIDEO_MODES,
  VIDEO_FRAME_PRESETS,
  VIDEO_RESOLUTION_PRESETS,
  DEFAULT_VIDEO_MODEL,
} from '../../lib/models'

/** 新架构统一状态：PENDING/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED */
const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING']

interface VideoTask extends TaskItem {
  status: string
  prompt?: string
  negative_prompt?: string
  mode?: string
  model?: string
  width?: number
  height?: number
  num_frames?: number
  frame_rate?: number
  seed?: number | string | null
  input_images?: string[]
  output_url?: string
  error_message?: unknown
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
    PENDING: '等待中',
    QUEUED: '排队中',
    RUNNING: '生成中',
    SUCCEEDED: '已完成',
    FAILED: '失败',
    CANCELED: '已取消',
  }
  return map[status] || status
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'PENDING':
    case 'QUEUED':
    case 'RUNNING':
      return 'badge-progress'
    case 'SUCCEEDED':
      return 'badge-completed'
    case 'FAILED':
    case 'CANCELED':
      return 'badge-failed'
    default:
      return 'badge'
  }
}

function modeLabel(mode?: string): string {
  return VIDEO_MODES.find((m) => m.id === mode)?.name || mode || '—'
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

/** 将后端 Generation 归一化为视图所需的 VideoTask。 */
function toVideoTask(g: Generation): VideoTask {
  const input = (g.input ?? {}) as Record<string, unknown>
  const images = input.images ?? input.image
  return {
    id: g.id,
    status: g.status,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    negative_prompt:
      typeof input.negativePrompt === 'string' ? input.negativePrompt : undefined,
    mode: typeof input.mode === 'string' ? input.mode : undefined,
    model: g.model ?? undefined,
    width: typeof input.width === 'number' ? input.width : undefined,
    height: typeof input.height === 'number' ? input.height : undefined,
    num_frames: typeof input.numFrames === 'number' ? input.numFrames : undefined,
    frame_rate: typeof input.frameRate === 'number' ? input.frameRate : undefined,
    seed: input.seed != null ? (input.seed as number | string) : null,
    input_images: Array.isArray(images) ? (images as string[]) : undefined,
    output_url: g.output?.url ?? undefined,
    error_message: g.errorMessage,
    created_at: g.completedAt ?? g.createdAt,
  }
}

function displayUrl(task: VideoTask): string {
  return task?.output_url || ''
}

function inputImagesOf(task: VideoTask): string[] {
  return task?.input_images || []
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
  const { alert } = useDialog()
  const { hasActiveKey, keyStatusLoading, refreshKeyStatus, requireApiKey } = useApiKeyGuard()

  const [form, setForm] = useState<VideoForm>({
    model: DEFAULT_VIDEO_MODEL,
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
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const [error, setError] = useState('')

  const { history, historyLoading, resetHistory, setHistory } = usePaginatedTaskHistory(
    useCallback(async () => {
      const list = await generationApi.list(50)
      return list.map(toVideoTask)
    }, []),
  )

  const formCardRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<TaskItem[]>(history)
  useEffect(() => {
    historyRef.current = history
  }, [history])
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingRef = useRef(false)
  const selectedTaskRef = useRef<string | number | null>(selectedTaskId)
  useEffect(() => {
    selectedTaskRef.current = selectedTaskId
  }, [selectedTaskId])
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const selectedTask: VideoTask | null =
    (history.find((t) => t.id === selectedTaskId) as VideoTask | undefined) || null

  const activeTasks = history.filter((t) => ACTIVE_STATUSES.includes(t.status))

  const selectedResolutionId = (() => {
    const match = VIDEO_RESOLUTION_PRESETS.find(
      (p) => p.width === form.width && p.height === form.height,
    )
    return match?.id || '720p-h'
  })()

  const resolutionGroups = [
    { label: '横屏', items: VIDEO_RESOLUTION_PRESETS.filter((p) => p.group === 'landscape') },
    { label: '竖屏', items: VIDEO_RESOLUTION_PRESETS.filter((p) => p.group === 'portrait') },
  ].filter((g) => g.items.length)

  const taskErrorMessage = useCallback(
    (task: VideoTask) =>
      formatErrorMessage(task?.error_message) || (task?.status === 'FAILED' ? '生成失败' : ''),
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
        (t) => ACTIVE_STATUSES.includes(t.status) && !String(t.id).startsWith('temp-'),
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
          const updated = await generationApi.get(String(task.id))
          const mapped = toVideoTask(updated)
          setHistory((prev) => prev.map((t) => (t.id === mapped.id ? mapped : t)))
          if (ACTIVE_STATUSES.includes(updated.status) === false && updated.status === 'FAILED') {
            const msg = taskErrorMessage(mapped)
            if (selectedTaskRef.current === mapped.id) setError(msg || '生成失败')
            await alert({ title: '生成失败', message: msg || '生成失败', confirmVariant: 'danger' })
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
    schedulePoll()
  }, [stopPolling, schedulePoll])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const res = await uploadApi.upload(file)
        setInputImages((prev) => [...prev, res.url])
      }
    } catch (err) {
      setError((err as Error).message)
      await alert({ title: '上传失败', message: (err as Error).message, confirmVariant: 'danger' })
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

  const applyPreset = (preset: { numFrames: number; frameRate: number }) => {
    setForm((prev) => ({ ...prev, num_frames: preset.numFrames, frame_rate: preset.frameRate }))
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
      status: 'PENDING',
      prompt: form.prompt,
      negative_prompt: form.negative_prompt || undefined,
      mode: form.mode,
      width: form.width,
      height: form.height,
      num_frames: form.num_frames,
      frame_rate: form.frame_rate,
      seed: form.seed,
      input_images: optimisticInputImages,
      _optimistic: true,
    }
    setHistory((prev) => [optimisticTask, ...prev])
    setSelectedTaskId(tempId)

    try {
      const input: Record<string, unknown> = {
        model: form.model,
        prompt: form.prompt,
        mode: form.mode,
        width: form.width,
        height: form.height,
        numFrames: form.num_frames,
        frameRate: form.frame_rate,
      }
      if (form.negative_prompt) input.negativePrompt = form.negative_prompt
      if (form.seed != null) input.seed = form.seed
      if (form.mode === 'img2video' && inputImages.length) {
        input.image = inputImages[0]
      } else if (['multi_img', 'keyframes'].includes(form.mode) && inputImages.length) {
        input.images = inputImages
      }

      const payload: CreateGenerationPayload = {
        type: 'VIDEO',
        provider: 'agnes',
        model: form.model,
        input,
      }
      const gen = await generationApi.create(payload)
      const mapped = toVideoTask(gen)
      setHistory((prev) => [
        mapped,
        ...prev.filter((t) => t.id !== tempId),
      ])
      setSelectedTaskId(mapped.id)
      startPollingAll()
      if (mapped.status === 'FAILED') setError(taskErrorMessage(mapped) || '提交失败')
    } catch (err) {
      setHistory((prev) => prev.filter((t) => t.id !== tempId))
      setSelectedTaskId(null)
      setError((err as Error).message)
      await alert({ title: '提交失败', message: (err as Error).message, confirmVariant: 'danger' })
    } finally {
      setSubmitting(false)
    }
  }, [
    form,
    inputImages,
    requireApiKey,
    setHistory,
    startPollingAll,
    alert,
    taskErrorMessage,
  ])

  const selectTask = (task: TaskItem) => setSelectedTaskId(task.id)

  const fillFormFromTask = (task: VideoTask) => {
    if (!task) return
    setForm({
      model: task.model || DEFAULT_VIDEO_MODEL,
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

  // Initial load
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refreshKeyStatus()
      if (cancelled) return
      await resetHistory()
      setSelectedTaskId(historyRef.current[0]?.id ?? null)
      startPollingAll()
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
          <p className="text-xs text-white/40">提交后自动轮询进度</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
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
                        #{task._optimistic ? '...' : String(task.id).slice(0, 8)}
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
                        {modeLabel(task.mode)}
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

                    {ACTIVE_STATUSES.includes(task.status) && (
                      <div className="mt-3">
                        <div className="progress-bar">
                          <div className="progress-fill animate-pulse" style={{ width: '40%' }} />
                        </div>
                        <p className="text-xs text-white/40 mt-1.5">{statusLabel(task.status)}...</p>
                      </div>
                    )}

                    {task.status === 'FAILED' && (
                      <p className="text-xs text-rose-300/80 mt-2 truncate">{taskErrorMessage(task)}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

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
                  余额不足，无法生成视频。请先前往
                  <Link href="/app/wallet" className="text-cyan-300 hover:underline">
                    {' '}钱包
                  </Link>
                  充值后再试。
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Form */}
              <div ref={formCardRef} className="glass-card space-y-4">
                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">生成模式</label>
                  <div className="grid grid-cols-2 gap-2">
                    {VIDEO_MODES.map((m) => (
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
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">模型</label>
                  <select
                    value={form.model}
                    onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                    className="select-field text-sm w-full"
                  >
                    {VIDEO_MODELS.map((m) => (
                      <option key={m.apiId} value={m.apiId}>
                        {m.name}
                        {m.deprecated ? ' (已废弃)' : ''}
                      </option>
                    ))}
                  </select>
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
                    <label className="btn-secondary inline-flex items-center gap-2 text-sm cursor-pointer">
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
                      const preset = VIDEO_RESOLUTION_PRESETS.find((p) => p.id === e.target.value)
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
                    {VIDEO_FRAME_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => applyPreset(p)}
                        className={`px-4 py-1.5 rounded-full text-xs border transition-all duration-200 ${
                          form.num_frames === p.numFrames
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
                        {selectedTask._optimistic ? '新任务' : `任务 #${String(selectedTask.id).slice(0, 8)}`}
                      </span>
                      <span className={statusBadgeClass(selectedTask.status)}>
                        {statusLabel(selectedTask.status)}
                      </span>
                    </div>

                    {ACTIVE_STATUSES.includes(selectedTask.status) && (
                      <div className="mb-5">
                        <div className="progress-bar h-3">
                          <div className="progress-fill animate-pulse" style={{ width: '40%' }} />
                        </div>
                        <p className="text-sm text-white/50 mt-2">
                          {statusLabel(selectedTask.status)}，请耐心等待（可能需要数分钟）
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
                          <span>{formatResolution(selectedTask)}</span>
                          <span>{formatDuration(selectedTask)}</span>
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
                    ) : ACTIVE_STATUSES.includes(selectedTask.status) ? (
                      <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-full border-4 border-fuchsia-400/30 border-t-fuchsia-400 animate-spin" />
                        <p className="text-white/50 mt-5 text-sm">视频生成中，可能需要数分钟</p>
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

                    {selectedTask.status === 'FAILED' || selectedTask.status === 'CANCELED' ? (
                      <div className="glass px-4 py-3 rounded-2xl border border-rose-400/30 mt-2">
                        <p className="text-rose-300 text-sm whitespace-pre-wrap break-words">
                          {statusLabel(selectedTask.status)}
                          {taskErrorMessage(selectedTask) ? `：${taskErrorMessage(selectedTask)}` : ''}
                        </p>
                      </div>
                    ) : null}

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
                          <div className="col-span-2">
                            <span className="text-white/40">模型</span>{' '}
                            <span className="text-white/70">{selectedTask.model || '—'}</span>
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