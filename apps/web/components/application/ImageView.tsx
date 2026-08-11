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
import { IMAGE_MODELS, IMAGE_MODES, IMAGE_SIZES, DEFAULT_IMAGE_MODEL } from '../../lib/models'

/** 新架构统一状态：PENDING/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED */
const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING']

interface ImageTask extends TaskItem {
  status: string
  prompt?: string
  mode?: string
  size?: string
  model?: string
  input_images?: string[]
  output_url?: string
  error_message?: unknown
  created_at?: string
}

interface InputImage {
  file?: File
  preview: string
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
  return IMAGE_MODES.find((m) => m.id === mode)?.name || mode || '—'
}

function modeTagClass(mode?: string): string {
  const map: Record<string, string> = {
    text2img: 'bg-pink-400/15 text-pink-200 border-pink-400/25',
    img2img: 'bg-violet-400/15 text-violet-200 border-violet-400/25',
    multi_img: 'bg-orange-400/15 text-orange-200 border-orange-400/25',
  }
  return map[mode || ''] || 'bg-white/10 text-white/60 border-white/15'
}

function formatSizeLabel(size: string): string {
  const parts = size.split('x').map(Number)
  const w = parts[0]
  const h = parts[1]
  if (!w || !h) return size
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(w, h)
  const ratio = `${w / g}:${h / g}`
  if (w === h) return `${size} (${ratio} 方图)`
  if (w > h) return `${size} (${ratio} 横图)`
  return `${size} (${ratio} 竖图)`
}

/** 将后端 Generation 归一化为视图所需的 ImageTask。 */
function toImageTask(g: Generation): ImageTask {
  const input = (g.input ?? {}) as Record<string, unknown>
  const images = input.images
  return {
    id: g.id,
    status: g.status,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    mode: typeof input.mode === 'string' ? input.mode : undefined,
    size: typeof input.size === 'string' ? input.size : undefined,
    model: g.model ?? undefined,
    input_images: Array.isArray(images) ? (images as string[]) : undefined,
    output_url: g.output?.url ?? undefined,
    error_message: g.errorMessage,
    created_at: g.completedAt ?? g.createdAt,
  }
}

function displayUrl(task: ImageTask): string {
  return task?.output_url || ''
}

function inputImagesOf(task: ImageTask): string[] {
  return task?.input_images || []
}

export default function ImageView() {
  const { alert } = useDialog()
  const { hasActiveKey, keyStatusLoading, refreshKeyStatus, requireApiKey } = useApiKeyGuard()

  const [form, setForm] = useState<Record<string, string>>({
    model: DEFAULT_IMAGE_MODEL,
    mode: 'text2img',
    prompt: '',
    size: '1024x768',
  })
  const [inputImages, setInputImages] = useState<InputImage[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateStep, setGenerateStep] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const [error, setError] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const { history, historyLoading, resetHistory, setHistory } = usePaginatedTaskHistory(
    useCallback(async () => {
      const list = await generationApi.list(50)
      return list.map(toImageTask)
    }, []),
  )

  const formCardRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedTask: ImageTask | null =
    (history.find((t) => t.id === selectedTaskId) as ImageTask | undefined) || null

  const revokePreview = (item: InputImage) => {
    if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview)
  }

  const selectMode = (modeId: string) => {
    setForm((prev) => ({ ...prev, mode: modeId }))
    if (modeId === 'img2img' && inputImages.length > 1) {
      inputImages.slice(1).forEach(revokePreview)
      setInputImages([inputImages[0]])
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (form.mode === 'img2img') {
      if (inputImages[0]) revokePreview(inputImages[0])
      setInputImages([{ file: files[0], preview: URL.createObjectURL(files[0]) }])
    } else {
      setInputImages((prev) => [
        ...prev,
        ...files.map((file) => ({ file, preview: URL.createObjectURL(file) })),
      ])
    }
    e.target.value = ''
  }

  const removeInputImage = (i: number) => {
    setInputImages((prev) => {
      const next = [...prev]
      revokePreview(next[i])
      next.splice(i, 1)
      return next
    })
  }

  const taskErrorMessage = (task: ImageTask) =>
    formatErrorMessage(task?.error_message) || (task?.status === 'FAILED' ? '生成失败' : '')

  /** 上传本地文件，返回可访问 URL 列表。 */
  const uploadLocalFiles = async (items: InputImage[]): Promise<string[]> => {
    const urls: string[] = []
    for (const item of items) {
      if (item.file) {
        const res = await uploadApi.upload(item.file)
        urls.push(res.url)
      } else if (item.preview && !item.preview.startsWith('blob:')) {
        urls.push(item.preview)
      }
    }
    return urls
  }

  const generate = useCallback(async () => {
    if (!form.prompt.trim()) {
      setError('请输入提示词')
      return
    }
    if (form.mode === 'img2img' && !inputImages.length) {
      setError('请选择参考图')
      return
    }
    if (form.mode === 'multi_img' && !inputImages.length) {
      setError('请选择输入图片')
      return
    }
    if (!(await requireApiKey())) return

    setGenerating(true)
    setGenerateStep(form.mode === 'text2img' ? 'generating' : 'uploading')
    setError('')

    const tempId = `temp-${Date.now()}`
    const optimisticTask: ImageTask = {
      id: tempId,
      status: 'RUNNING',
      prompt: form.prompt,
      mode: form.mode,
      size: form.size,
      model: form.model,
      _optimistic: true,
    }
    setHistory((prev) => [optimisticTask, ...prev])
    setSelectedTaskId(tempId)

    try {
      let images: string[] | undefined
      if (form.mode !== 'text2img' && inputImages.length) {
        setGenerateStep('uploading')
        images = await uploadLocalFiles(inputImages)
      }

      const payload: CreateGenerationPayload = {
        type: 'IMAGE',
        provider: 'agnes',
        model: form.model,
        input: {
          prompt: form.prompt,
          mode: form.mode,
          size: form.size,
          ...(images ? { images } : {}),
        },
      }
      setGenerateStep('generating')
      const gen = await generationApi.create(payload)
      const task = toImageTask(gen)
      setHistory((prev) => [
        task,
        ...prev.filter((t) => t.id !== tempId),
      ])
      setSelectedTaskId(task.id)
    } catch (err) {
      setHistory((prev) => prev.filter((t) => t.id !== tempId))
      setSelectedTaskId(null)
      setError((err as Error).message)
      await alert({ title: '生成失败', message: (err as Error).message, confirmVariant: 'danger' })
    } finally {
      setGenerating(false)
      setGenerateStep('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, inputImages, requireApiKey, alert, setHistory])

  const openLightbox = (url: string) => {
    if (url) setLightboxUrl(url)
  }
  const closeLightbox = () => setLightboxUrl(null)

  const selectTask = (task: TaskItem) => setSelectedTaskId(task.id)

  const fillFormFromTask = (task: ImageTask) => {
    if (!task || task._optimistic) return
    setForm({
      model: task.model || DEFAULT_IMAGE_MODEL,
      mode: task.mode || 'text2img',
      prompt: task.prompt || '',
      size: task.size || '1024x768',
    })
    inputImages.forEach(revokePreview)
    setInputImages(inputImagesOf(task).map((url) => ({ preview: url })))
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
      if (history.length) setSelectedTaskId(history[0].id)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // cleanup blob urls
  useEffect(() => {
    return () => {
      inputImages.forEach(revokePreview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full">
      {/* Task list sidebar */}
      <div className="w-96 border-r border-white/10 flex flex-col bg-black/10">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-white">生成历史</h3>
            {generating && <span className="badge-progress">生成中</span>}
          </div>
          <p className="text-xs text-white/40">点击预览</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {history.map((rawTask) => {
            const task = rawTask as ImageTask
            const isSelected = selectedTaskId === task.id
            return (
              <div
                key={String(task.id)}
                onClick={() => selectTask(task)}
                className={`group p-3 rounded-2xl cursor-pointer transition-all duration-200 border ${
                  isSelected
                    ? 'bg-gradient-to-r from-pink-500/20 to-orange-400/10 border-white/25 shadow-glow-cyan'
                    : 'border-white/15 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-xl flex-shrink-0 overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center">
                    {displayUrl(task) ? (
                      <img
                        src={displayUrl(task)}
                        alt={task.prompt || '生成的图片'}
                        className="w-full h-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          openLightbox(displayUrl(task))
                        }}
                      />
                    ) : ACTIVE_STATUSES.includes(task.status) ? (
                      <div className="w-6 h-6 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
                    ) : (
                      <span className="text-xs text-white/40">{statusLabel(task.status)}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-white/40 font-mono">
                        #{task._optimistic ? '...' : String(task.id).slice(0, 8)}
                      </span>
                      <span className={statusBadgeClass(task.status)}>{statusLabel(task.status)}</span>
                    </div>
                    <p className="text-sm text-white/90 truncate font-medium mt-1">{task.prompt}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${modeTagClass(
                          task.mode,
                        )}`}
                      >
                        {modeLabel(task.mode)}
                      </span>
                      <span className="text-xs text-white/40">{formatSizeLabel(task.size || '')}</span>
                    </div>
                    {task.status === 'FAILED' && (
                      <p className="text-xs text-rose-300/80 mt-1.5 truncate">{taskErrorMessage(task)}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {!history.length && !historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-white/40">
              <div className="text-4xl mb-3">🎨</div>
              <p className="text-sm">暂无生成记录</p>
              <p className="text-xs mt-1">填写参数后点击生成</p>
            </div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            <div>
              <h2 className="text-2xl font-extrabold bg-gradient-to-r from-pink-300 via-fuchsia-300 to-orange-300 bg-clip-text text-transparent">
                图片生成
              </h2>
              <p className="text-white/50 text-sm mt-1">文生图 · 单图编辑 · 多图合成</p>
            </div>

            {!keyStatusLoading && !hasActiveKey && (
              <div className="glass-card border border-amber-400/30 bg-amber-400/10 py-3 px-4">
                <p className="text-sm text-amber-100/90">
                  余额不足，无法生成图片。请先前往
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
                  <div className="grid grid-cols-3 gap-2">
                    {IMAGE_MODES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => selectMode(m.id)}
                        className={`px-3 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200 border ${
                          form.mode === m.id
                            ? 'border-fuchsia-400/50 bg-gradient-to-r from-fuchsia-500/25 to-pink-400/15 text-white shadow-glow-cyan'
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
                    className="select-field text-sm"
                  >
                    {IMAGE_MODELS.map((m) => (
                      <option key={m.apiId} value={m.apiId}>
                        {m.name}
                        {m.deprecated ? ' (已废弃)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">尺寸</label>
                  <select
                    value={form.size}
                    onChange={(e) => setForm((prev) => ({ ...prev, size: e.target.value }))}
                    className="select-field text-sm"
                  >
                    {IMAGE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {formatSizeLabel(s)}
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
                    placeholder="描述你想生成的图片内容..."
                  />
                </div>

                {form.mode !== 'text2img' && (
                  <div>
                    <label className="text-sm text-white/60 mb-2 block font-medium">
                      {form.mode === 'img2img' ? '参考图' : '输入图片'}
                    </label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {inputImages.map((item, i) => (
                        <div key={i} className="relative group">
                          <img
                            src={item.preview}
                            alt="参考图"
                            className="w-20 h-20 object-cover rounded-2xl border border-white/20"
                          />
                          <button
                            onClick={() => removeInputImage(i)}
                            className="absolute -top-1 -right-1 w-6 h-6 bg-rose-500 rounded-full text-xs opacity-0 group-hover:opacity-100 shadow-lg"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <label className="btn-secondary inline-flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple={form.mode === 'multi_img'}
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      {form.mode === 'img2img'
                        ? inputImages.length
                          ? '更换参考图'
                          : '选择参考图'
                        : '+ 选择图片'}
                    </label>
                  </div>
                )}

                {error && (
                  <p className="text-rose-300 text-sm glass px-4 py-2 rounded-2xl border border-rose-400/30">
                    {error}
                  </p>
                )}

                <button onClick={generate} disabled={generating} className="btn-primary w-full py-3 text-base">
                  {generateStep === 'uploading'
                    ? '上传并生成中...'
                    : generating
                      ? '生成中...'
                      : '✨ 开始生成'}
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
                      <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-full border-4 border-fuchsia-400/30 border-t-fuchsia-400 animate-spin" />
                        <p className="text-white/50 mt-5 text-sm">图片生成中，请稍候...</p>
                      </div>
                    )}

                    {!ACTIVE_STATUSES.includes(selectedTask.status) && displayUrl(selectedTask) && (
                      <div className="flex-1">
                        <p className="text-xs text-white/50 mb-2 font-medium">生成结果</p>
                        <img
                          src={displayUrl(selectedTask)}
                          alt={selectedTask.prompt || '生成的图片'}
                          className="w-full rounded-2xl border border-white/15 shadow-glow object-contain max-h-[360px] bg-black/20 cursor-zoom-in hover:opacity-90 transition-opacity"
                          onClick={() => openLightbox(displayUrl(selectedTask))}
                        />
                        <div className="mt-3 text-xs text-white/50 flex flex-wrap gap-4">
                          <span>{formatSizeLabel(selectedTask.size || '')}</span>
                        </div>
                      </div>
                    )}

                    {selectedTask.status === 'FAILED' || selectedTask.status === 'CANCELED' ? (
                      <div className="glass px-4 py-3 rounded-2xl border border-rose-400/30">
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
                          <span className="text-white/40 text-xs">提示词</span>
                          <p className="text-white/80 mt-0.5 leading-relaxed">{selectedTask.prompt || '—'}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-1">
                          <div>
                            <span className="text-white/40">模式</span>{' '}
                            <span className="text-white/70">{modeLabel(selectedTask.mode)}</span>
                          </div>
                          <div>
                            <span className="text-white/40">尺寸</span>{' '}
                            <span className="text-white/70">{formatSizeLabel(selectedTask.size || '')}</span>
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
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-400/30 to-orange-400/30 flex items-center justify-center text-4xl mb-4 border border-white/20 animate-float">
                      🎨
                    </div>
                    <p>选择左侧记录或创建新任务</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 md:p-8" onClick={closeLightbox}>
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors z-10">
            ✕
          </button>
          <img
            src={lightboxUrl}
            alt="预览"
            className="relative max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}