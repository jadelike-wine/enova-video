'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { imageApi } from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useApiKeyGuard, imageModeNeedsQiniu } from './useApiKeyGuard'
import { usePaginatedTaskHistory, type TaskItem } from './usePaginatedTaskHistory'
import { formatErrorMessage } from '../../lib/errorMessage'
import { canRefreshTaskStatus } from '../../lib/transientError'
import TrashIcon from './TrashIcon'

const modes = [
  { id: 'text2img', name: '文生图' },
  { id: 'img2img', name: '单图编辑' },
  { id: 'multi_img', name: '多图合成' },
]

interface ImageTask extends TaskItem {
  id: number | string
  status: string
  prompt?: string
  mode?: string
  size?: string
  input_images?: string | string[]
  output_url?: string
  qiniu_url?: string
  request_params?: string | Record<string, unknown>
  error_message?: unknown
  duration_ms?: number
  revised_prompt?: string
  created_at?: string
}

interface InputImage {
  file?: File
  preview: string
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

function modeLabel(mode?: string): string {
  return modes.find((m) => m.id === mode)?.name || mode || '—'
}

function modeTagClass(mode?: string): string {
  const map: Record<string, string> = {
    text2img: 'bg-pink-400/15 text-pink-200 border-pink-400/25',
    img2img: 'bg-violet-400/15 text-violet-200 border-violet-400/25',
    multi_img: 'bg-orange-400/15 text-orange-200 border-orange-400/25',
  }
  return map[mode || ''] || 'bg-white/10 text-white/60 border-white/15'
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    processing: '生成中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] || status
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    processing: 'badge-progress',
    completed: 'badge-completed',
    failed: 'badge-failed',
  }
  return map[status] || 'badge'
}

function displayUrl(task: ImageTask): string {
  return task?.qiniu_url || task?.output_url || ''
}

function inputImagesOf(task: ImageTask): string[] {
  if (!task?.input_images) return []
  if (Array.isArray(task.input_images)) return task.input_images
  try {
    const parsed = JSON.parse(task.input_images)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function ImageView() {
  const { confirm, alert } = useDialog()
  const {
    hasActiveKey,
    hasStorageConfig,
    keyStatusLoading,
    refreshKeyStatus,
    requireApiKey,
    requireStorageConfig,
  } = useApiKeyGuard()

  const [meta, setMeta] = useState<{ models: { id: string; name: string }[]; sizes: string[] }>({
    models: [],
    sizes: [],
  })
  const [form, setForm] = useState<Record<string, string>>({
    model: 'agnes-image-2.1-flash',
    mode: 'text2img',
    prompt: '',
    size: '1024x768',
    response_format: 'url',
  })
  const [inputImages, setInputImages] = useState<InputImage[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateStep, setGenerateStep] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<number | string | null>(null)
  const [error, setError] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [refreshingTaskId, setRefreshingTaskId] = useState<number | string | null>(null)

  const { history, historyLoading, historyHasMore, resetHistory, loadMoreHistory, setHistory } =
    usePaginatedTaskHistory((params) => imageApi.listTasks(params) as Promise<TaskItem[]>)

  const formCardRef = useRef<HTMLDivElement>(null)
  const historyScrollRef = useRef<HTMLDivElement>(null)
  const historySentinelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setFormAndDeferred = (setter: (f: Record<string, string>) => Record<string, string>) => {
    setForm((prev) => setter(prev))
  }

  const selectedTask: ImageTask | null =
    (history.find((t) => t.id === selectedTaskId) as ImageTask | undefined) || null

  const currentModeNeedsQiniu = imageModeNeedsQiniu(form.mode)

  const revokePreview = (item: InputImage) => {
    if (item?.preview?.startsWith('blob:')) {
      URL.revokeObjectURL(item.preview)
    }
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
    if (!(await requireStorageConfig())) {
      e.target.value = ''
      return
    }
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

  const hasLocalFiles = () => inputImages.length > 0 && inputImages.every((item) => item.file)
  const imageUrlsFromInput = () => inputImages.map((item) => item.preview).filter(Boolean)

  const taskErrorMessage = (task: ImageTask) =>
    formatErrorMessage(task?.error_message) || (task?.status === 'failed' ? '生成失败' : '')

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
    if (currentModeNeedsQiniu && !(await requireStorageConfig())) return

    setGenerating(true)
    setGenerateStep(form.mode === 'text2img' ? 'generating' : 'uploading')
    setError('')

    const previewUrls = inputImages.map((item) => item.preview)
    const tempId = `temp-${Date.now()}`
    const optimisticTask: ImageTask = {
      id: tempId,
      status: 'processing',
      prompt: form.prompt,
      mode: form.mode,
      size: form.size,
      input_images: form.mode !== 'text2img' ? previewUrls : undefined,
      created_at: new Date().toISOString(),
      _optimistic: true,
    }

    setHistory([optimisticTask, ...history])
    setSelectedTaskId(tempId)

    try {
      const payload = { ...form }
      let task: TaskItem
      if (form.mode === 'img2img') {
        if (hasLocalFiles()) {
          setGenerateStep('uploading')
          task = await imageApi.generate(payload, [inputImages[0].file!])
        } else {
          setGenerateStep('generating')
          task = await imageApi.generate({ ...payload, images: imageUrlsFromInput() })
        }
      } else if (form.mode === 'multi_img') {
        if (hasLocalFiles()) {
          setGenerateStep('uploading')
          task = await imageApi.generate(payload, inputImages.map((item) => item.file!))
        } else {
          setGenerateStep('generating')
          task = await imageApi.generate({ ...payload, images: imageUrlsFromInput() })
        }
      } else {
        setGenerateStep('generating')
        task = await imageApi.generate(payload)
      }
      setHistory([task, ...history.filter((t) => t.id !== tempId)])
      setSelectedTaskId(task.id)
    } catch (err) {
      const remaining = history.filter((t) => t.id !== tempId)
      setHistory(remaining)
      setSelectedTaskId(remaining[0]?.id || null)
      setError((err as Error).message)
      await alert({ title: '生成失败', message: (err as Error).message, confirmVariant: 'danger' })
    } finally {
      setGenerating(false)
      setGenerateStep('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, inputImages, currentModeNeedsQiniu, requireApiKey, requireStorageConfig, alert, history, setHistory])

  const deleteTask = useCallback(
    async (task: ImageTask, e?: React.MouseEvent) => {
      e?.stopPropagation()
      if (task._optimistic) return
      const ok = await confirm({
        title: '删除图片',
        message: '确定删除此生成结果？删除后无法恢复。',
        confirmText: '删除',
        cancelText: '取消',
        confirmVariant: 'danger',
      })
      if (!ok) return
      try {
        await imageApi.deleteTask(task.id as number)
        await resetHistory()
        if (selectedTaskId === task.id) {
          setSelectedTaskId(history.filter((t) => t.id !== task.id)[0]?.id || null)
        }
      } catch (err) {
        await alert({ title: '删除失败', message: (err as Error).message, confirmVariant: 'danger' })
      }
    },
    [confirm, selectedTaskId, resetHistory, history, alert],
  )

  const openLightbox = (url: string) => {
    if (url) setLightboxUrl(url)
  }

  const closeLightbox = () => setLightboxUrl(null)

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [])

  const refreshTaskStatus = useCallback(
    async (task: ImageTask) => {
      if (!task?.id || task._optimistic || refreshingTaskId) return
      setRefreshingTaskId(task.id)
      setError('')
      try {
        const updated = (await imageApi.syncTask(task.id as number)) as ImageTask
        await resetHistory()
        setSelectedTaskId(updated.id)
        if (updated.status === 'failed') {
          await alert({
            title: '仍未完成',
            message: taskErrorMessage(updated) || '生成尚未成功，请稍后再试',
            confirmVariant: 'danger',
          })
        }
      } catch (err) {
        setError((err as Error).message)
        await alert({ title: '刷新失败', message: (err as Error).message, confirmVariant: 'danger' })
        try {
          const latest = (await imageApi.getTask(task.id as number)) as ImageTask
          await resetHistory()
          setSelectedTaskId(latest.id)
        } catch {
          /* ignore */
        }
      } finally {
        setRefreshingTaskId(null)
      }
    },
    [refreshingTaskId, alert, resetHistory],
  )

  const selectTask = (task: TaskItem) => setSelectedTaskId(task.id)

  const fillFormFromTask = (task: ImageTask) => {
    if (!task || task._optimistic) return
    let responseFormat = 'url'
    try {
      const params =
        typeof task.request_params === 'string'
          ? JSON.parse(task.request_params)
          : task.request_params
      const extra = (params as Record<string, Record<string, string>>)?.extra_body
      responseFormat = extra?.response_format || 'url'
    } catch {
      /* ignore */
    }
    setForm({
      model: task.model || 'agnes-image-2.1-flash',
      mode: task.mode || 'text2img',
      prompt: task.prompt || '',
      size: task.size || '1024x768',
      response_format: responseFormat,
    })
    inputImages.forEach(revokePreview)
    setInputImages(inputImagesOf(task).map((url) => ({ preview: url })))
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
      const data = await imageApi.getModels()
      if (cancelled) return
      setMeta(data)
      await resetHistory()
      if (history.length) {
        setSelectedTaskId(history[0].id)
      }
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
          <p className="text-xs text-white/40">点击预览，悬停可删除</p>
        </div>

        <div ref={historyScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
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
                    ) : task.status === 'processing' ? (
                      <div className="w-6 h-6 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
                    ) : (
                      <span className="text-xs text-white/40">{statusLabel(task.status)}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-white/40 font-mono">
                        #{task._optimistic ? '...' : task.id}
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
                    {task.status === 'failed' && (
                      <p className="text-xs text-rose-300/80 mt-1.5 truncate">{taskErrorMessage(task)}</p>
                    )}
                    {canRefreshTaskStatus(task, 'image') && (
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
                    className={`w-8 h-8 rounded-xl flex items-center justify-center text-white/50 hover:bg-rose-500/30 hover:text-rose-300 transition-all flex-shrink-0 self-center ${
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
                  尚未配置 Agnes AI API Key，无法生成图片。请前往
                  <Link href="/app/settings" className="text-cyan-300 hover:underline">
                    {' '}设置
                  </Link>
                  添加并启用 Key。
                </p>
              </div>
            )}

            {!keyStatusLoading && !hasStorageConfig && (
              <div className="glass-card border border-sky-400/25 bg-sky-400/10 py-3 px-4">
                <p className="text-sm text-sky-100/90">
                  未配置七牛云对象存储：当前可使用<strong className="font-semibold text-white/90">文生图</strong>；单图编辑、多图合成需上传参考图，暂不可用。生成结果使用 Agnes 临时链接，可能无法长期访问。
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
                  <div className="grid grid-cols-3 gap-2">
                    {modes.map((m) => (
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
                  {!keyStatusLoading && !hasStorageConfig && currentModeNeedsQiniu && (
                    <p className="text-xs text-amber-200/90 mt-2 glass px-3 py-2 rounded-xl border border-amber-400/25">
                      此模式需上传参考图，请先配置七牛云对象存储。
                      <Link href="/app/settings#storage" className="text-cyan-300 hover:underline">
                        {' '}查看说明
                      </Link>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">模型</label>
                  <select
                    value={form.model}
                    onChange={(e) => setFormAndDeferred((f) => ({ ...f, model: e.target.value }))}
                    className="select-field text-sm"
                  >
                    {meta.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm text-white/60 mb-2 block font-medium">尺寸</label>
                  <select
                    value={form.size}
                    onChange={(e) => setFormAndDeferred((f) => ({ ...f, size: e.target.value }))}
                    className="select-field text-sm"
                  >
                    {meta.sizes.map((s) => (
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
                    onChange={(e) => setFormAndDeferred((f) => ({ ...f, prompt: e.target.value }))}
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
                    <label
                      className={`btn-secondary inline-flex items-center gap-2 text-sm ${
                        !hasStorageConfig
                          ? 'opacity-50 cursor-not-allowed pointer-events-none'
                          : 'cursor-pointer'
                      }`}
                    >
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
                    {form.mode === 'img2img' && (
                      <p className="text-xs text-white/40 mt-2">
                        仅支持一张参考图，选择新图将替换当前参考图；提交任务时才会上传
                      </p>
                    )}
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

                    {selectedTask.status === 'processing' && (
                      <div className="flex-1 flex flex-col">
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <div className="w-16 h-16 rounded-full border-4 border-fuchsia-400/30 border-t-fuchsia-400 animate-spin" />
                          <p className="text-white/50 mt-5 text-sm">图片生成中，请稍候...</p>
                          {canRefreshTaskStatus(selectedTask, 'image') && (
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
                                  className="w-20 h-20 object-cover rounded-xl border border-white/20 cursor-zoom-in hover:border-fuchsia-400/40 transition-colors"
                                  onClick={() => openLightbox(url)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedTask.status !== 'processing' && displayUrl(selectedTask) && (
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
                          {selectedTask.duration_ms ? (
                            <span>耗时: {selectedTask.duration_ms}ms</span>
                          ) : null}
                          {selectedTask.qiniu_url ? (
                            <span className="text-emerald-300">✓ 已存储至七牛云</span>
                          ) : null}
                        </div>
                        {selectedTask.revised_prompt && (
                          <p className="mt-3 text-xs text-white/40 leading-relaxed">
                            优化提示词: {selectedTask.revised_prompt}
                          </p>
                        )}
                        {inputImagesOf(selectedTask).length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-white/50 mb-2 font-medium">参考图</p>
                            <div className="flex flex-wrap gap-2">
                              {inputImagesOf(selectedTask).map((url, i) => (
                                <img
                                  key={i}
                                  src={url}
                                  alt="参考图"
                                  className="w-20 h-20 object-cover rounded-xl border border-white/20 cursor-zoom-in hover:border-fuchsia-400/40 transition-colors"
                                  onClick={() => openLightbox(url)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedTask.status === 'failed' && (
                      <div className="glass px-4 py-3 rounded-2xl border border-rose-400/30">
                        <p className="text-rose-300 text-sm whitespace-pre-wrap break-words">
                          {taskErrorMessage(selectedTask)}
                        </p>
                        {canRefreshTaskStatus(selectedTask, 'image') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              refreshTaskStatus(selectedTask)
                            }}
                            className="btn-primary mt-3 px-4 py-2 text-sm"
                          >
                            {refreshingTaskId === selectedTask.id ? '刷新中...' : '手动刷新状态'}
                          </button>
                        )}
                        {canRefreshTaskStatus(selectedTask, 'image') && (
                          <p className="text-xs text-white/40 mt-2">
                            若因限流导致状态未更新，可点击刷新重新获取结果
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
                          <span className="text-white/40 text-xs">提示词</span>
                          <p className="text-white/80 mt-0.5 leading-relaxed">{selectedTask.prompt || '—'}</p>
                        </div>
                        {selectedTask.revised_prompt && (
                          <div>
                            <span className="text-white/40 text-xs">优化提示词</span>
                            <p className="text-white/60 mt-0.5 leading-relaxed">{selectedTask.revised_prompt}</p>
                          </div>
                        )}
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
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4 md:p-8"
          onClick={closeLightbox}
        >
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