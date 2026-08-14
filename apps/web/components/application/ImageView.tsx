'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Alert, Button, Image as AntdImage, Form, Input, Select, Tag } from 'antd'
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
import { IMAGE_MODELS, IMAGE_MODES, IMAGE_SIZES, DEFAULT_IMAGE_MODEL, modelDisplayName } from '../../lib/models'

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

interface ImageFormValues {
  model: string
  mode: string
  prompt: string
  size: string
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

function statusBadgeColor(status: string): 'processing' | 'success' | 'error' | 'default' {
  switch (status) {
    case 'PENDING':
    case 'QUEUED':
    case 'RUNNING':
      return 'processing'
    case 'SUCCEEDED':
      return 'success'
    case 'FAILED':
    case 'CANCELED':
      return 'error'
    default:
      return 'default'
  }
}

function modeLabel(mode?: string): string {
  return IMAGE_MODES.find((m) => m.id === mode)?.name || mode || '—'
}

function modeTagColor(mode?: string): string {
  const map: Record<string, string> = {
    text2img: 'pink',
    img2img: 'purple',
    multi_img: 'orange',
  }
  return map[mode || ''] || 'default'
}

function formatSizeLabel(t: ReturnType<typeof useTranslations<'image'>>, size: string): string {
  const parts = size.split('x').map(Number)
  const w = parts[0]
  const h = parts[1]
  if (!w || !h) return size
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(w, h)
  const ratio = `${w / g}:${h / g}`
  if (w === h) return `${size} (${ratio} ${t('squareImage')})`
  if (w > h) return `${size} (${ratio} ${t('landscapeImage')})`
  return `${size} (${ratio} ${t('portraitImage')})`
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
  const t = useTranslations('image')
  const tc = useTranslations()
  const { alert } = useDialog()
  const { hasActiveKey, keyStatusLoading, refreshKeyStatus, requireApiKey } = useApiKeyGuard()

  const [form] = Form.useForm<ImageFormValues>()
  const [inputImages, setInputImages] = useState<InputImage[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateStep, setGenerateStep] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const [error, setError] = useState('')
  const [currentMode, setCurrentMode] = useState('text2img')

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

  const handleModeChange = (modeId: string) => {
    setCurrentMode(modeId)
    if (modeId === 'img2img' && inputImages.length > 1) {
      inputImages.slice(1).forEach(revokePreview)
      setInputImages([inputImages[0]])
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (currentMode === 'img2img') {
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
    formatErrorMessage(task?.error_message) || (task?.status === 'FAILED' ? t('generateFailed') : '')

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

  const generate = useCallback(async (values: ImageFormValues) => {
    if (!values.prompt.trim()) {
      setError(t('promptRequired'))
      return
    }
    if (values.mode === 'img2img' && !inputImages.length) {
      setError(t('referenceRequired'))
      return
    }
    if (values.mode === 'multi_img' && !inputImages.length) {
      setError(t('inputImagesRequired'))
      return
    }
    if (!(await requireApiKey())) return

    setGenerating(true)
    setGenerateStep(values.mode === 'text2img' ? 'generating' : 'uploading')
    setError('')

    const tempId = `temp-${Date.now()}`
    const optimisticTask: ImageTask = {
      id: tempId,
      status: 'RUNNING',
      prompt: values.prompt,
      mode: values.mode,
      size: values.size,
      model: values.model,
      _optimistic: true,
    }
    setHistory((prev) => [optimisticTask, ...prev])
    setSelectedTaskId(tempId)

    try {
      let images: string[] | undefined
      if (values.mode !== 'text2img' && inputImages.length) {
        setGenerateStep('uploading')
        images = await uploadLocalFiles(inputImages)
      }

      const payload: CreateGenerationPayload = {
        type: 'IMAGE',
        provider: 'agnes',
        model: values.model,
        input: {
          prompt: values.prompt,
          mode: values.mode,
          size: values.size,
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
      await alert({ title: t('generateFailed'), message: (err as Error).message, confirmVariant: 'danger' })
    } finally {
      setGenerating(false)
      setGenerateStep('')
    }
  }, [inputImages, requireApiKey, alert, setHistory, t])

  const selectTask = (task: TaskItem) => setSelectedTaskId(task.id)

  const fillFormFromTask = (task: ImageTask) => {
    if (!task || task._optimistic) return
    form.setFieldsValue({
      model: task.model || DEFAULT_IMAGE_MODEL,
      mode: task.mode || 'text2img',
      prompt: task.prompt || '',
      size: task.size || '1024x768',
    })
    setCurrentMode(task.mode || 'text2img')
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
      <div className="w-96 border-r border-gray-200 flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-gray-900">{t('history')}</h3>
            {generating && <Tag color="processing">{t('generating')}</Tag>}
          </div>
          <p className="text-xs text-gray-400">{t('clickToPreview')}</p>
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
                    ? 'bg-gradient-to-r from-pink-500/20 to-orange-400/10 border-gray-300'
                    : 'border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                }`}
              >
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-xl flex-shrink-0 overflow-hidden bg-gray-50 border border-gray-200 flex items-center justify-center">
                    {displayUrl(task) ? (
                      <AntdImage
                        src={displayUrl(task)}
                        alt={task.prompt || '生成的图片'}
                        width="100%"
                        height="100%"
                        className="object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                        preview={{ mask: false }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : ACTIVE_STATUSES.includes(task.status) ? (
                      <div className="w-6 h-6 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
                    ) : (
                      <span className="text-xs text-gray-400">{statusLabel(tc, task.status)}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400 font-mono">
                        #{task._optimistic ? '...' : String(task.id).slice(0, 8)}
                      </span>
                      <Tag color={statusBadgeColor(task.status)} className="!m-0">
                        {statusLabel(tc, task.status)}
                      </Tag>
                    </div>
                    <p className="text-sm text-gray-800 truncate font-medium mt-1">{task.prompt}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Tag color={modeTagColor(task.mode)} className="!m-0 !text-[10px]">
                        {modeLabel(task.mode)}
                      </Tag>
                      <span className="text-xs text-gray-400">{formatSizeLabel(t, task.size || '')}</span>
                    </div>
                    {task.status === 'FAILED' && (
                      <p className="text-xs text-rose-600 mt-1.5 truncate">{taskErrorMessage(task)}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {!history.length && !historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="text-4xl mb-3">🎨</div>
              <p className="text-sm">{t('noHistory')}</p>
              <p className="text-xs mt-1">{t('noHistoryHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            <div>
              <h2 className="text-2xl font-extrabold bg-gradient-to-r from-pink-600 via-fuchsia-600 to-orange-600 bg-clip-text text-transparent">
                {t('title')}
              </h2>
              <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
            </div>

            {!keyStatusLoading && !hasActiveKey && (
              <Alert
                type="warning"
                showIcon
                message={
                  <span>
                    {t('insufficientBalance')}{' '}
                    <Link href="/app/wallet" className="text-cyan-600 hover:underline">
                      {tc('common.wallet')}
                    </Link>
                    {t('rechargeHint')}
                  </span>
                }
              />
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Form */}
              <div ref={formCardRef} className="glass-card">
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={generate}
                  initialValues={{
                    model: DEFAULT_IMAGE_MODEL,
                    mode: 'text2img',
                    prompt: '',
                    size: '1024x768',
                  }}
                >
                  <Form.Item label={t('generationMode')} name="mode">
                    <Select
                      onChange={(val) => handleModeChange(val as string)}
                      options={IMAGE_MODES.map((m) => ({ value: m.id, label: m.name }))}
                    />
                  </Form.Item>

                  <Form.Item label={t('model')} name="model">
                    <Select
                      options={IMAGE_MODELS.map((m) => ({
                        value: m.apiId,
                        label: m.deprecated ? `${m.name} (${t('deprecated')})` : m.name,
                      }))}
                    />
                  </Form.Item>

                  <Form.Item label={t('size')} name="size">
                    <Select
                      options={IMAGE_SIZES.map((s) => ({
                        value: s,
                        label: formatSizeLabel(t, s),
                      }))}
                    />
                  </Form.Item>

                  <Form.Item label={t('prompt')} name="prompt">
                    <Input.TextArea rows={3} placeholder={t('promptPlaceholder')} />
                  </Form.Item>

                  {currentMode !== 'text2img' && (
                    <Form.Item label={currentMode === 'img2img' ? t('referenceImage') : t('inputImages')}>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {inputImages.map((item, i) => (
                          <div key={i} className="relative group">
                            <AntdImage
                              src={item.preview}
                              alt={t('referenceImage')}
                              width={80}
                              height={80}
                              preview={false}
                              className="object-cover rounded-2xl border border-gray-200"
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
                      <Button onClick={() => fileInputRef.current?.click()}>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple={currentMode === 'multi_img'}
                          className="hidden"
                          onChange={handleFileSelect}
                        />
                        {currentMode === 'img2img'
                          ? inputImages.length
                            ? t('changeReference')
                            : t('selectReference')
                          : t('selectImages')}
                      </Button>
                    </Form.Item>
                  )}

                  {error && <Alert type="error" message={error} showIcon className="mb-4" />}

                  <Form.Item>
                    <Button type="primary" htmlType="submit" block size="large" loading={generating}>
                      {generateStep === 'uploading'
                        ? t('generatingWithUpload')
                        : generating
                          ? t('generatingNow')
                          : t('startGenerate')}
                    </Button>
                  </Form.Item>
                </Form>
              </div>

              {/* Preview */}
              <div className="glass-card flex flex-col min-h-[420px]">
                {selectedTask ? (
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-bold text-gray-900">
                        {selectedTask._optimistic ? t('newTask') : `${t('taskPrefix')} #${String(selectedTask.id).slice(0, 8)}`}
                      </span>
                      <Tag color={statusBadgeColor(selectedTask.status)}>
                        {statusLabel(tc, selectedTask.status)}
                      </Tag>
                    </div>

                    {ACTIVE_STATUSES.includes(selectedTask.status) && (
                      <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-full border-4 border-fuchsia-400/30 border-t-fuchsia-400 animate-spin" />
                        <p className="text-gray-500 mt-5 text-sm">{t('generatingHint')}</p>
                      </div>
                    )}

                    {!ACTIVE_STATUSES.includes(selectedTask.status) && displayUrl(selectedTask) && (
                      <div className="flex-1">
                        <p className="text-xs text-gray-500 mb-2 font-medium">{t('result')}</p>
                        <AntdImage
                          src={displayUrl(selectedTask)}
                          alt={selectedTask.prompt || t('generatedImage')}
                          width="100%"
                          className="rounded-2xl border border-gray-200 object-contain max-h-[360px] bg-gray-100 cursor-zoom-in hover:opacity-90 transition-opacity"
                          preview={{ mask: false }}
                        />
                        <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-4">
                          <span>{formatSizeLabel(t, selectedTask.size || '')}</span>
                        </div>
                      </div>
                    )}

                    {selectedTask.status === 'FAILED' || selectedTask.status === 'CANCELED' ? (
                      <Alert
                        type="error"
                        className="mt-2"
                        message={`${statusLabel(tc, selectedTask.status)}${taskErrorMessage(selectedTask) ? `：${taskErrorMessage(selectedTask)}` : ''}`}
                      />
                    ) : null}

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-gray-500 font-medium">{t('params')}</p>
                        {!selectedTask._optimistic && (
                          <Button size="small" onClick={() => fillFormFromTask(selectedTask)}>
                            {t('fillForm')}
                          </Button>
                        )}
                      </div>
                      <div className="glass px-4 py-3 rounded-2xl border border-gray-200 space-y-2 text-sm">
                        <div>
                          <span className="text-gray-400 text-xs">{t('prompt')}</span>
                          <p className="text-gray-800 mt-0.5 leading-relaxed">{selectedTask.prompt || '—'}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-1">
                          <div>
                            <span className="text-gray-400">{t('mode')}</span>{' '}
                            <span className="text-gray-700">{modeLabel(selectedTask.mode)}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">{t('size')}</span>{' '}
                            <span className="text-gray-700">{formatSizeLabel(t, selectedTask.size || '')}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-gray-400">{t('model')}</span>{' '}
                            <span className="text-gray-700">{modelDisplayName(selectedTask.model)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <div className="w-20 h-20 rounded-3xl bg-pink-100 flex items-center justify-center text-4xl mb-4 border border-gray-200">
                      🎨
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
