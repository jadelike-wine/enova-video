'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Image as AntdImage } from 'antd'
import { useTranslations } from 'next-intl'
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
  modelDisplayName,
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

function statusLabel(t: (k: string) => string, status: string): string {
  const map: Record<string, string> = {
    PENDING: t('status.PENDING'),
    QUEUED: t('status.QUEUED'),
    RUNNING: t('status.RUNNING'),
    SUCCEEDED: t('status.SUCCEEDED'),
    FAILED: t('status.FAILED'),
    CANCELED: t('status.CANCELED'),
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
    text2video: 'bg-cyan-400/15 text-cyan-600 border-cyan-400/25',
    img2video: 'bg-violet-400/15 text-violet-600 border-violet-400/25',
    multi_img: 'bg-orange-400/15 text-orange-600 border-orange-400/25',
    keyframes: 'bg-pink-400/15 text-pink-600 border-pink-400/25',
  }
  return map[mode || ''] || 'bg-gray-100 text-gray-600 border-gray-200'
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
  const t = useTranslations('video')
  const tc = useTranslations()
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
    { label: t('landscape'), items: VIDEO_RESOLUTION_PRESETS.filter((p) => p.group === 'landscape') },
    { label: t('portrait'), items: VIDEO_RESOLUTION_PRESETS.filter((p) => p.group === 'portrait') },
  ].filter((g) => g.items.length)

  const taskErrorMessage = useCallback(
    (task: VideoTask) =>
      formatErrorMessage(task?.error_message) || (task?.status === 'FAILED' ? t('generateFailed') : ''),
    [t],
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
            if (selectedTaskRef.current === mapped.id) setError(msg || t('generateFailed'))
            await alert({ title: t('generateFailed'), message: msg || t('generateFailed'), confirmVariant: 'danger' })
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
  }, [pendingTasks, stopPolling, schedulePoll, setHistory, alert, taskErrorMessage, t])

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
      await alert({ title: t('uploadFailed'), message: (err as Error).message, confirmVariant: 'danger' })
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
      setError(t('promptRequired'))
      return
    }
    if (form.mode === 'img2video' && !inputImages.length) {
      setError(t('uploadImageRequired'))
      return
    }
    if (['multi_img', 'keyframes'].includes(form.mode) && inputImages.length < 2) {
      setError(t('atLeastTwoImages'))
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
      if (mapped.status === 'FAILED') setError(taskErrorMessage(mapped) || t('submitFailed'))
    } catch (err) {
      setHistory((prev) => prev.filter((t) => t.id !== tempId))
      setSelectedTaskId(null)
      setError((err as Error).message)
      await alert({ title: t('submitFailed'), message: (err as Error).message, confirmVariant: 'danger' })
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
    t,
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
      <div className="w-96 border-r border-gray-200 flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-gray-900">{t('taskList')}</h3>
            {activeTasks.length > 0 && (
              <span className="badge-progress">{activeTasks.length} {t('inProgress')}</span>
            )}
          </div>
          <p className="text-xs text-gray-400">{t('autoPolling')}</p>
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
                    ? 'bg-gradient-to-r from-fuchsia-500/20 to-cyan-400/10 border-gray-300'
                    : 'border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                }`}
              >
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs text-gray-400 font-mono">
                        #{task._optimistic ? '...' : String(task.id).slice(0, 8)}
                      </span>
                      <span className={statusBadgeClass(task.status)}>{statusLabel(tc, task.status)}</span>
                    </div>
                    <p className="text-sm text-gray-800 truncate font-medium">{task.prompt}</p>
                    {task.negative_prompt && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {t('negativeLabel')}: {task.negative_prompt}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-500 mt-1 font-mono">{formatTaskMeta(task)}</p>
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
                          <AntdImage
                            key={i}
                            src={url}
                            alt={inputImagesOf(task).length > 1 ? t('referenceImageN', { n: i + 1 }) : t('referenceImagesLabel')}
                            width={40}
                            height={40}
                            preview={false}
                            className="object-cover rounded-lg border border-gray-200"
                          />
                        ))}
                      </div>
                    )}

                    {ACTIVE_STATUSES.includes(task.status) && (
                      <div className="mt-3">
                        <div className="progress-bar">
                          <div className="progress-fill animate-pulse" style={{ width: '40%' }} />
                        </div>
                        <p className="text-xs text-gray-400 mt-1.5">{statusLabel(tc, task.status)}...</p>
                      </div>
                    )}

                    {task.status === 'FAILED' && (
                      <p className="text-xs text-rose-600 mt-2 truncate">{taskErrorMessage(task)}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {!history.length && historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="w-6 h-6 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
              <p className="text-xs mt-3">{t('loading')}</p>
            </div>
          )}

          {!history.length && !historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="text-4xl mb-3">🎬</div>
              <p className="text-sm">{t('noTasks')}</p>
              <p className="text-xs mt-1">{t('noTasksHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Main area: form + preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            <div>
              <h2 className="text-2xl font-extrabold bg-gradient-to-r from-cyan-600 via-fuchsia-600 to-orange-600 bg-clip-text text-transparent">
                {t('title')}
              </h2>
              <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
            </div>

            {!keyStatusLoading && !hasActiveKey && (
              <div className="glass-card border border-amber-400/30 bg-amber-400/10 py-3 px-4">
                <p className="text-sm text-amber-600">
                  {t('insufficientBalance')}{' '}
                  <Link href="/app/wallet" className="text-cyan-600 hover:underline">
                    {tc('common.wallet')}
                  </Link>
                  {t('rechargeHint')}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Form */}
              <div ref={formCardRef} className="glass-card space-y-4">
                <div>
                  <label className="text-sm text-gray-600 mb-2 block font-medium">{t('generationMode')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {VIDEO_MODES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => selectMode(m.id)}
                        className={`px-3 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200 border ${
                          form.mode === m.id
                            ? 'border-fuchsia-400/50 bg-gradient-to-r from-fuchsia-500/25 to-cyan-400/15 text-white'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-600 mb-2 block font-medium">{t('model')}</label>
                  <select
                    value={form.model}
                    onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                    className="select-field text-sm w-full"
                  >
                    {VIDEO_MODELS.map((m) => (
                      <option key={m.apiId} value={m.apiId}>
                        {m.name}
                        {m.deprecated ? ` (${t('deprecated')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm text-gray-600 mb-2 block font-medium">{t('prompt')}</label>
                  <textarea
                    value={form.prompt}
                    onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
                    rows={3}
                    className="input-field text-sm"
                    placeholder={t('promptPlaceholder')}
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-600 mb-2 block font-medium">
                    {t('negativePrompt')}
                  </label>
                  <input
                    value={form.negative_prompt}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, negative_prompt: e.target.value }))
                    }
                    className="input-field text-sm"
                    placeholder={t('negativePromptPlaceholder')}
                  />
                </div>

                {form.mode !== 'text2video' && (
                  <div>
                    <label className="text-sm text-gray-600 mb-2 block font-medium">
                      {form.mode === 'img2video' ? t('inputImage') : t('referenceImages')}
                    </label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {inputImages.map((url, i) => (
                        <div key={i} className="relative group">
                          <AntdImage
                            src={url}
                            alt={t('referenceImagesLabel')}
                            width={80}
                            height={80}
                            preview={false}
                            className="object-cover rounded-2xl border border-gray-200"
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
                      {uploading ? t('uploading') : t('uploadImages')}
                    </label>
                  </div>
                )}

                <div>
                  <label className="text-sm text-gray-600 mb-2 block font-medium">{t('resolution')}</label>
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
                  <label className="text-sm text-gray-600 mb-2 block font-medium">{t('duration')}</label>
                  <div className="flex flex-wrap gap-2">
                    {VIDEO_FRAME_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => applyPreset(p)}
                        className={`px-4 py-1.5 rounded-full text-xs border transition-all duration-200 ${
                          form.num_frames === p.numFrames
                            ? 'border-fuchsia-400/50 text-fuchsia-600 bg-fuchsia-500/20'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-gray-600 mb-2 block">{t('frames')}</label>
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
                    <label className="text-sm text-gray-600 mb-2 block">{t('frameRate')}</label>
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
                  <label className="text-sm text-gray-600 mb-2 block">{t('seed')}</label>
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
                    placeholder={t('seedPlaceholder')}
                  />
                </div>

                {error && (
                  <p className="text-rose-600 text-sm glass px-4 py-2 rounded-2xl border border-rose-400/30">
                    {error}
                  </p>
                )}

                <button onClick={generate} disabled={submitting} className="btn-primary w-full py-3 text-base">
                  {submitting ? t('submitting') : t('startGenerate')}
                </button>
              </div>

              {/* Preview */}
              <div className="glass-card flex flex-col min-h-[420px]">
                {selectedTask ? (
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-bold text-gray-900">
                        {selectedTask._optimistic ? t('newTask') : `${t('taskPrefix')} #${String(selectedTask.id).slice(0, 8)}`}
                      </span>
                      <span className={statusBadgeClass(selectedTask.status)}>
                        {statusLabel(tc, selectedTask.status)}
                      </span>
                    </div>

                    {ACTIVE_STATUSES.includes(selectedTask.status) && (
                      <div className="mb-5">
                        <div className="progress-bar h-3">
                          <div className="progress-fill animate-pulse" style={{ width: '40%' }} />
                        </div>
                        <p className="text-sm text-gray-500 mt-2">
                          {t('generatingWithStatus', { status: statusLabel(tc, selectedTask.status) })}
                        </p>
                      </div>
                    )}

                    {displayUrl(selectedTask) ? (
                      <div className="flex-1">
                        <video
                          src={displayUrl(selectedTask)}
                          controls
                          className="w-full rounded-2xl border border-gray-200"
                        />
                        <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-4">
                          <span>{formatResolution(selectedTask)}</span>
                          <span>{formatDuration(selectedTask)}</span>
                        </div>
                        {inputImagesOf(selectedTask).length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-gray-500 mb-2 font-medium">{t('referenceImagesLabel')}</p>
                            <div className="flex flex-wrap gap-2">
                              {inputImagesOf(selectedTask).map((url, i) => (
                                <AntdImage
                                  key={i}
                                  src={url}
                                  alt={t('referenceImagesLabel')}
                                  width={80}
                                  height={80}
                                  preview={{ mask: false }}
                                  className="object-cover rounded-xl border border-gray-200"
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : ACTIVE_STATUSES.includes(selectedTask.status) ? (
                      <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-full border-4 border-fuchsia-400/30 border-t-fuchsia-400 animate-spin" />
                        <p className="text-gray-500 mt-5 text-sm">{t('generatingHint')}</p>
                        {inputImagesOf(selectedTask).length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-gray-500 mb-2 font-medium">{t('referenceImagesLabel')}</p>
                            <div className="flex flex-wrap gap-2">
                              {inputImagesOf(selectedTask).map((url, i) => (
                                <AntdImage
                                  key={i}
                                  src={url}
                                  alt={t('referenceImagesLabel')}
                                  width={80}
                                  height={80}
                                  preview={{ mask: false }}
                                  className="object-cover rounded-xl border border-gray-200"
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {selectedTask.status === 'FAILED' || selectedTask.status === 'CANCELED' ? (
                      <div className="glass px-4 py-3 rounded-2xl border border-rose-400/30 mt-2">
                        <p className="text-rose-600 text-sm whitespace-pre-wrap break-words">
                          {statusLabel(tc, selectedTask.status)}
                          {taskErrorMessage(selectedTask) ? `：${taskErrorMessage(selectedTask)}` : ''}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-gray-500 font-medium">{t('params')}</p>
                        {!selectedTask._optimistic && (
                          <button
                            onClick={() => fillFormFromTask(selectedTask)}
                            className="btn-secondary text-xs px-3 py-1.5"
                          >
                            {t('fillForm')}
                          </button>
                        )}
                      </div>
                      <div className="glass px-4 py-3 rounded-2xl border border-gray-200 space-y-2 text-sm">
                        <div>
                          <span className="text-gray-400 text-xs">{t('positivePrompt')}</span>
                          <p className="text-gray-800 mt-0.5 leading-relaxed">
                            {selectedTask.prompt || '—'}
                          </p>
                        </div>
                        {selectedTask.negative_prompt && (
                          <div>
                            <span className="text-gray-400 text-xs">{t('negativePromptLabel')}</span>
                            <p className="text-gray-600 mt-0.5 leading-relaxed">
                              {selectedTask.negative_prompt}
                            </p>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-1">
                          <div>
                            <span className="text-gray-400">{t('resolutionLabel')}</span>{' '}
                            <span className="text-gray-700">{formatResolution(selectedTask)}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">{t('durationLabel')}</span>{' '}
                            <span className="text-gray-700">{formatDuration(selectedTask)}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">{t('framesLabel')}</span>{' '}
                            <span className="text-gray-700">{selectedTask.num_frames ?? '—'}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">{t('frameRateLabel')}</span>{' '}
                            <span className="text-gray-700">
                              {selectedTask.frame_rate != null
                                ? `${selectedTask.frame_rate} fps`
                                : '—'}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-gray-400">{t('seedLabel')}</span>{' '}
                            <span className="text-gray-700 font-mono">
                              {selectedTask.seed != null && selectedTask.seed !== ''
                                ? selectedTask.seed
                                : t('random')}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-gray-400">{t('modelLabel')}</span>{' '}
                            <span className="text-gray-700">{modelDisplayName(selectedTask.model)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <div className="w-20 h-20 rounded-3xl bg-cyan-100 flex items-center justify-center text-4xl mb-4 border border-gray-200">
                      🎬
                    </div>
                    <p>{t('selectOrCreate')}</p>
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