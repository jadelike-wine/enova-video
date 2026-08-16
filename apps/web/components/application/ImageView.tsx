'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Button,
  Divider,
  Dropdown,
  Form,
  Input,
  Image as AntdImage,
  Select,
  Segmented,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileImageOutlined,
  InboxOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
} from '@ant-design/icons'
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
import {
  IMAGE_MODELS,
  IMAGE_MODES,
  IMAGE_QUALITY_SIZES,
  IMAGE_RATIOS,
  getImageOutputDimensions,
  legacySizeToNative,
  DEFAULT_IMAGE_MODEL,
  modelDisplayName,
} from '../../lib/models'
import { useSession } from '../../lib/auth'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 多图合成模式最大上传数量 */
const MAX_COMPOSE_IMAGES = 6

/** 上传图片允许的格式 */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** 单张上传图片大小上限（10 MB） */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024

/** 生成模式联合类型 */
type GenerationMode = 'text2img' | 'img2img' | 'multi_img'

/** Prompt 最大字符数 */
const MAX_PROMPT_LENGTH = 2000

/** 新架构统一状态 */
const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING']

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface ImageTask extends TaskItem {
  status: string
  prompt?: string
  mode?: string
  size?: string
  ratio?: string
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
  ratio: string
}

/** Preview Panel 的四种状态 */
type PreviewState = 'empty' | 'generating' | 'success' | 'error'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

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

function formatSizeRatioLabel(size?: string, ratio?: string): string {
  if (!size) return '—'
  if (!ratio) return size
  const dims = getImageOutputDimensions(size, ratio)
  return dims ? `${size} · ${ratio} · ${dims}` : `${size} · ${ratio}`
}

/** 将后端 Generation 归一化为视图所需的 ImageTask */
function toImageTask(g: Generation): ImageTask {
  const input = (g.input ?? {}) as Record<string, unknown>
  const images = input.images
  let size = typeof input.size === 'string' ? input.size : undefined
  let ratio = typeof input.ratio === 'string' ? input.ratio : undefined
  if (size && !ratio && legacySizeToNative(size)) {
    const native = legacySizeToNative(size)!
    ratio = native.ratio
    size = native.size
  }
  return {
    id: g.id,
    status: g.status,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    mode: typeof input.mode === 'string' ? input.mode : undefined,
    size,
    ratio,
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

/** 格式化相对时间 */
function relativeTime(dateStr?: string): string {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

/** 判断 Preview 状态 */
function getPreviewState(task: ImageTask | null, generating: boolean): PreviewState {
  if (!task) return 'empty'
  if (ACTIVE_STATUSES.includes(task.status) || generating) return 'generating'
  if (task.status === 'FAILED' || task.status === 'CANCELED') return 'error'
  if (displayUrl(task)) return 'success'
  return 'empty'
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export default function ImageView() {
  const t = useTranslations('image')
  const tc = useTranslations()
  const { alert, confirm } = useDialog()
  const { hasActiveKey, keyStatusLoading, refreshKeyStatus, requireApiKey } = useApiKeyGuard()
  const { balance } = useSession()

  const [form] = Form.useForm<ImageFormValues>()
  const [inputImages, setInputImages] = useState<InputImage[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateStep, setGenerateStep] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const [error, setError] = useState('')
  const [currentMode, setCurrentMode] = useState<GenerationMode>('text2img')
  const [promptValue, setPromptValue] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const { history, historyLoading, resetHistory, setHistory } = usePaginatedTaskHistory(
    useCallback(async () => {
      const list = await generationApi.list(50)
      return list.map(toImageTask)
    }, []),
  )

  const formCardRef = useRef<HTMLDivElement>(null)

  const selectedTask: ImageTask | null =
    (history.find((t) => t.id === selectedTaskId) as ImageTask | undefined) || null

  const previewState = useMemo(
    () => getPreviewState(selectedTask, generating),
    [selectedTask, generating],
  )

  const revokePreview = useCallback((item: InputImage) => {
    if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview)
  }, [])

  // ---- 模式切换 ----
  const handleModeChange = useCallback(
    (mode: string) => {
      setCurrentMode(mode as GenerationMode)
      if (mode === 'img2img' && inputImages.length > 1) {
        inputImages.slice(1).forEach(revokePreview)
        setInputImages([inputImages[0]])
      }
    },
    [inputImages, revokePreview],
  )

  // ---- 文件校验 ----
  const validateFile = useCallback(
    (file: File): string | null => {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        return t('uploadFormats')
      }
      if (file.size > MAX_UPLOAD_SIZE) {
        return `${file.name} > 10MB`
      }
      return null
    },
    [t],
  )

  // ---- 单图上传处理 ----
  const handleSingleUpload = useCallback(
    (file: File) => {
      const err = validateFile(file)
      if (err) {
        setError(err)
        return false
      }
      setError('')
      if (inputImages[0]) revokePreview(inputImages[0])
      setInputImages([{ file, preview: URL.createObjectURL(file) }])
      return false
    },
    [inputImages, revokePreview, validateFile],
  )

  // ---- 多图上传处理 ----
  const handleMultiUpload = useCallback(
    (file: File) => {
      const err = validateFile(file)
      if (err) {
        setError(err)
        return false
      }
      if (inputImages.length >= MAX_COMPOSE_IMAGES) {
        setError(`${MAX_COMPOSE_IMAGES}`)
        return false
      }
      setError('')
      setInputImages((prev) => [
        ...prev,
        { file, preview: URL.createObjectURL(file) },
      ])
      return false
    },
    [inputImages, validateFile],
  )

  const removeInputImage = useCallback(
    (i: number) => {
      setInputImages((prev) => {
        const next = [...prev]
        revokePreview(next[i])
        next.splice(i, 1)
        return next
      })
    },
    [revokePreview],
  )

  const replaceInputImage = useCallback(
    (i: number) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = ACCEPTED_IMAGE_TYPES.join(',')
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const err = validateFile(file)
        if (err) {
          setError(err)
          return
        }
        setInputImages((prev) => {
          const next = [...prev]
          revokePreview(next[i])
          next[i] = { file, preview: URL.createObjectURL(file) }
          return next
        })
      }
      input.click()
    },
    [revokePreview, validateFile],
  )


  /** 上传本地文件，返回可访问 URL 列表 */
  const uploadLocalFiles = useCallback(
    async (items: InputImage[]): Promise<string[]> => {
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
    },
    [],
  )

  // ---- 生成 ----
  const generate = useCallback(
    async (values: ImageFormValues) => {
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
        ratio: values.ratio,
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
            ratio: values.ratio,
            ...(images ? { images } : {}),
          },
        }
        setGenerateStep('generating')
        const gen = await generationApi.create(payload)
        const task = toImageTask(gen)
        setHistory((prev) => [task, ...prev.filter((t) => t.id !== tempId)])
        setSelectedTaskId(task.id)
      } catch (err) {
        setHistory((prev) => prev.filter((t) => t.id !== tempId))
        setSelectedTaskId(null)
        setError((err as Error).message)
        await alert({
          title: t('generateFailed'),
          message: (err as Error).message,
          confirmVariant: 'danger',
        })
      } finally {
        setGenerating(false)
        setGenerateStep('')
      }
    },
    [inputImages, requireApiKey, alert, setHistory, t, uploadLocalFiles],
  )

  const selectTask = useCallback((task: TaskItem) => setSelectedTaskId(task.id), [])

  const fillFormFromTask = useCallback(
    (task: ImageTask) => {
      if (!task || task._optimistic) return
      form.setFieldsValue({
        model: task.model || DEFAULT_IMAGE_MODEL,
        mode: task.mode || 'text2img',
        prompt: task.prompt || '',
        size: task.size || '1K',
        ratio: task.ratio || '1:1',
      })
      setPromptValue(task.prompt || '')
      setCurrentMode((task.mode as GenerationMode) || 'text2img')
      inputImages.forEach(revokePreview)
      setInputImages(inputImagesOf(task).map((url) => ({ preview: url })))
      setError('')
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [form, revokePreview, inputImages],
  )

  // ---- 复制提示词 ----
  const copyPrompt = useCallback(
    async (prompt?: string) => {
      if (!prompt) return
      try {
        await navigator.clipboard.writeText(prompt)
      } catch {
        // fallback
      }
    },
    [],
  )

  // ---- 下载图片 ----
  const downloadImage = useCallback(async (url: string, name?: string) => {
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = name || `enova-${Date.now()}.png`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  // ---- 清空历史 ----
  const handleClearHistory = useCallback(async () => {
    const ok = await confirm({
      title: t('clearHistory'),
      message: t('clearHistoryConfirm'),
    })
    if (ok) {
      setHistory([])
      setSelectedTaskId(null)
    }
  }, [confirm, setHistory, t])

  // ---- 再次生成（从历史任务恢复参数并提交） ----
  const regenerateFromTask = useCallback(
    (task: ImageTask) => {
      fillFormFromTask(task)
      form.submit()
    },
    [fillFormFromTask, form],
  )

  // ---- 历史项右键菜单 ----
  const getHistoryMenuItems = useCallback(
    (task: ImageTask): MenuProps['items'] => [
      {
        key: 'regenerate',
        label: t('regenerate'),
        icon: <ReloadOutlined />,
        onClick: () => regenerateFromTask(task),
      },
      {
        key: 'copyPrompt',
        label: t('copyPrompt'),
        icon: <CopyOutlined />,
        onClick: () => copyPrompt(task.prompt),
      },
      {
        key: 'download',
        label: t('download'),
        icon: <DownloadOutlined />,
        disabled: !displayUrl(task),
        onClick: () => displayUrl(task) && downloadImage(displayUrl(task)),
      },
      { type: 'divider' },
      {
        key: 'delete',
        label: t('delete'),
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => {
          setHistory((prev) => prev.filter((t) => t.id !== task.id))
          if (selectedTaskId === task.id) setSelectedTaskId(null)
        },
      },
    ],
    [regenerateFromTask, copyPrompt, downloadImage, setHistory, selectedTaskId, t],
  )

  // ---- Initial load ----
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

  // ---- cleanup blob urls ----
  useEffect(() => {
    return () => {
      inputImages.forEach(revokePreview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 当前尺寸显示 ----
  const currentSize = Form.useWatch('size', form)
  const currentRatio = Form.useWatch('ratio', form)
  const currentDims = useMemo(() => {
    if (currentSize && currentRatio) return getImageOutputDimensions(currentSize, currentRatio)
    return null
  }, [currentSize, currentRatio])

  // ---- Segmented 选项 ----
  const modeOptions = useMemo(
    () =>
      IMAGE_MODES.map((m) => ({
        value: m.id,
        label: m.name,
      })),
    [],
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* ================================================================ */}
      {/* Generation History Sidebar (260~280px)                           */}
      {/* ================================================================ */}
      <div className="w-[280px] flex-shrink-0 border-r border-gray-100 flex flex-col bg-white">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <Typography.Text strong className="!text-sm !text-gray-900">
              {t('history')}
            </Typography.Text>
            {history.length > 0 && (
              <Button
                type="text"
                size="small"
                className="!text-xs !text-gray-400 hover:!text-gray-700"
                onClick={() => void handleClearHistory()}
              >
                {t('clearHistory')}
              </Button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {history.map((rawTask) => {
            const task = rawTask as ImageTask
            const isSelected = selectedTaskId === task.id
            return (
              <Dropdown
                key={String(task.id)}
                trigger={['contextMenu']}
                menu={{ items: getHistoryMenuItems(task) }}
              >
                <div
                  onClick={() => selectTask(task)}
                  className={`group relative p-2.5 rounded-xl cursor-pointer transition-all duration-200 border ${
                    isSelected
                      ? 'bg-primary-50/60 border-primary-200/80'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <div className="flex gap-2.5">
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-lg flex-shrink-0 overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center">
                      {displayUrl(task) ? (
                        <AntdImage
                          src={displayUrl(task)}
                          alt={task.prompt || t('generatedImage')}
                          width="100%"
                          height="100%"
                          className="object-cover"
                          preview={{ mask: false }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : ACTIVE_STATUSES.includes(task.status) ? (
                        <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                      ) : (
                        <FileImageOutlined className="text-gray-300 text-lg" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate font-medium leading-tight">
                        {task.prompt || '—'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-xs text-gray-400">
                          {modeLabel(task.mode)}
                        </span>
                        <span className="text-xs text-gray-300">·</span>
                        <span className="text-xs text-gray-400">
                          {formatSizeRatioLabel(task.size, task.ratio)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-400">
                          {relativeTime(task.created_at)}
                        </span>
                        <Tag
                          color={statusBadgeColor(task.status)}
                          className="!m-0 !text-[10px] !px-1.5"
                        >
                          {statusLabel(tc, task.status)}
                        </Tag>
                      </div>
                    </div>

                    {/* Hover More Menu */}
                    <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Dropdown trigger={['click']} menu={{ items: getHistoryMenuItems(task) }}>
                        <Button
                          type="text"
                          size="small"
                          className="!w-6 !h-6 !min-w-6 flex items-center justify-center !text-gray-400 hover:!text-gray-700"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="More actions"
                        >
                          <MoreOutlined />
                        </Button>
                      </Dropdown>
                    </div>
                  </div>
                </div>
              </Dropdown>
            )
          })}

          {!history.length && !historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <PictureOutlined className="text-3xl text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">{t('historyEmpty')}</p>
              <p className="text-xs text-gray-300 mt-1">{t('historyEmptyHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* Workspace                                                         */}
      {/* ================================================================ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Config Panel (420~460px) */}
        <div
          ref={formCardRef}
          className="w-[440px] flex-shrink-0 border-r border-gray-100 flex flex-col overflow-y-auto bg-white"
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={generate}
            initialValues={{
              model: DEFAULT_IMAGE_MODEL,
              mode: 'text2img',
              prompt: '',
              size: '1K',
              ratio: '1:1',
            }}
            className="flex flex-col h-full"
          >
            {/* Page Header */}
            <div className="px-6 pt-6 pb-4">
              <Typography.Title level={3} className="!mb-1 !text-gray-900" style={{ fontSize: 24, fontWeight: 600 }}>
                {t('title')}
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {t('subtitle')}
              </Typography.Text>
            </div>

            {!keyStatusLoading && !hasActiveKey && (
              <div className="px-6 mb-2">
                <Alert
                  type="warning"
                  showIcon
                  message={
                    <span>
                      {t('insufficientBalance')}{' '}
                      <Link href="/app/wallet" className="text-primary-600 hover:underline">
                        {tc('common.wallet')}
                      </Link>
                      {t('rechargeHint')}
                    </span>
                  }
                />
              </div>
            )}

            {/* Mode Segmented - 最顶部 */}
            <div className="px-6 mb-5">
              <Segmented
                block
                value={currentMode}
                onChange={(val) => handleModeChange(val as string)}
                options={modeOptions}
              />
            </div>

            {/* Prompt Editor - 最高视觉优先级 */}
            <div className="px-6 mb-5">
              <div className="flex items-center justify-between mb-2">
                <Typography.Text strong className="!text-sm">
                  {t('prompt')}
                </Typography.Text>
                <Button
                  type="text"
                  size="small"
                  className="!text-xs !text-primary-600 hover:!text-primary-700"
                  aria-label={t('optimizePrompt')}
                >
                  {t('optimizePrompt')}
                </Button>
              </div>
              <Form.Item name="prompt" className="!mb-0">
                <Input.TextArea
                  autoSize={{ minRows: 5, maxRows: 10 }}
                  placeholder={t('promptPlaceholder')}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  maxLength={MAX_PROMPT_LENGTH}
                  className="!resize-none"
                  aria-label={t('prompt')}
                />
              </Form.Item>
              <div className="flex justify-end mt-1">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {promptValue.length} / {MAX_PROMPT_LENGTH}
                </Typography.Text>
              </div>
            </div>

            {/* Image Upload Area (仅 img2img / multi_img) */}
            {currentMode !== 'text2img' && (
              <div className="px-6 mb-5">
                <Typography.Text strong className="!text-sm block mb-2">
                  {currentMode === 'img2img' ? t('referenceImage') : t('inputImages')}
                </Typography.Text>

                {/* 单图编辑模式 */}
                {currentMode === 'img2img' && (
                  <>
                    {inputImages.length === 0 ? (
                      <Upload.Dragger
                        accept={ACCEPTED_IMAGE_TYPES.join(',')}
                        showUploadList={false}
                        beforeUpload={(file) => {
                          handleSingleUpload(file)
                          return false
                        }}
                        className="!bg-gray-50/50 !border-dashed !border-gray-200 !rounded-xl !hover:!border-primary-400"
                        style={{ padding: '8px 0' }}
                      >
                        <div className="flex flex-col items-center py-4">
                          <InboxOutlined className="text-2xl text-gray-300 mb-2" />
                          <p className="text-sm text-gray-600">{t('uploadHint')}</p>
                          <p className="text-xs text-gray-400 mt-1">{t('uploadFormats')}</p>
                        </div>
                      </Upload.Dragger>
                    ) : (
                      <div className="relative group inline-block">
                        <AntdImage
                          src={inputImages[0].preview}
                          alt={t('referenceImage')}
                          width={120}
                          height={120}
                          preview={false}
                          className="object-cover rounded-xl border border-gray-100"
                        />
                        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip title={t('replace')}>
                            <Button
                              type="primary"
                              size="small"
                              className="!w-6 !h-6 !min-w-6 !p-0 flex items-center justify-center"
                              onClick={() => replaceInputImage(0)}
                              aria-label={t('replace')}
                            >
                              <SwapOutlined />
                            </Button>
                          </Tooltip>
                          <Tooltip title={t('delete')}>
                            <Button
                              size="small"
                              className="!w-6 !h-6 !min-w-6 !p-0 flex items-center justify-center"
                              onClick={() => removeInputImage(0)}
                              aria-label={t('delete')}
                            >
                              <DeleteOutlined />
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* 多图合成模式 */}
                {currentMode === 'multi_img' && (
                  <div>
                    <div className="flex flex-wrap gap-2">
                      {inputImages.map((item, i) => (
                        <div
                          key={i}
                          className="relative group w-[100px] h-[100px] flex-shrink-0"
                        >
                          <AntdImage
                            src={item.preview}
                            alt={`${t('inputImages')} ${i + 1}`}
                            width={100}
                            height={100}
                            preview={false}
                            className="object-cover rounded-xl border border-gray-100"
                          />
                          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip title={t('replace')}>
                              <Button
                                type="primary"
                                size="small"
                                className="!w-5 !h-5 !min-w-5 !p-0 flex items-center justify-center"
                                onClick={() => replaceInputImage(i)}
                                aria-label={t('replace')}
                              >
                                <SwapOutlined style={{ fontSize: 11 }} />
                              </Button>
                            </Tooltip>
                            <Tooltip title={t('delete')}>
                              <Button
                                size="small"
                                className="!w-5 !h-5 !min-w-5 !p-0 flex items-center justify-center"
                                onClick={() => removeInputImage(i)}
                                aria-label={t('delete')}
                              >
                                <DeleteOutlined style={{ fontSize: 11 }} />
                              </Button>
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                      {inputImages.length < MAX_COMPOSE_IMAGES && (
                        <Upload
                          accept={ACCEPTED_IMAGE_TYPES.join(',')}
                          showUploadList={false}
                          beforeUpload={(file) => {
                            handleMultiUpload(file)
                            return false
                          }}
                        >
                          <div className="w-[100px] h-[100px] rounded-xl border border-dashed border-gray-200 hover:border-primary-400 hover:bg-gray-50/50 flex flex-col items-center justify-center cursor-pointer transition-all">
                            <PlusOutlined className="text-lg text-gray-400 mb-1" />
                            <span className="text-xs text-gray-400">{t('addImage')}</span>
                          </div>
                        </Upload>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t('uploadedCount', { count: inputImages.length, max: MAX_COMPOSE_IMAGES })}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t('dragReorder')}
                      </Typography.Text>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Model Selector */}
            <div className="px-6 mb-5">
              <Typography.Text strong className="!text-sm block mb-2">
                {t('model')}
              </Typography.Text>
              <Form.Item name="model" className="!mb-0">
                <Select
                  options={IMAGE_MODELS.map((m) => ({
                    value: m.apiId,
                    label: (
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">{m.name}</span>
                          <span className="text-xs text-gray-400">
                            {m.apiId === DEFAULT_IMAGE_MODEL ? t('modelTagFast') : t('modelTagPro')}
                          </span>
                        </div>
                        {m.apiId === DEFAULT_IMAGE_MODEL && (
                          <Tag color="green" className="!m-0 !text-[10px]">
                            {t('modelRecommended')}
                          </Tag>
                        )}
                      </div>
                    ),
                  }))}
                />
              </Form.Item>
            </div>

            {/* Image Settings */}
            <div className="px-6 mb-5">
              <Typography.Text strong className="!text-sm block mb-2">
                {t('imageSettings')}
              </Typography.Text>
              <Form.Item name="size" className="!mb-2">
                <Select
                  options={IMAGE_QUALITY_SIZES.map((s) => ({ value: s.id, label: s.label }))}
                />
              </Form.Item>
              <Form.Item name="ratio" className="!mb-0">
                <Select
                  options={IMAGE_RATIOS.map((r) => ({ value: r.id, label: r.label }))}
                />
              </Form.Item>
              {currentDims && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('outputSize')}: {currentDims}
                </Typography.Text>
              )}
            </div>

            {/* Advanced Settings (折叠) */}
            <div className="px-6 mb-5">
              <Divider className="!my-2 !border-gray-100" />
              <Button
                type="text"
                className="!px-0 !text-sm !text-gray-500 hover:!text-gray-900"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                aria-expanded={advancedOpen}
              >
                {t('advancedSettings')} {advancedOpen ? '˄' : '˅'}
              </Button>
              {advancedOpen && (
                <div className="mt-3 space-y-3">
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Seed · Negative Prompt · CFG · Steps · Style
                  </Typography.Text>
                </div>
              )}
            </div>

            {/* Error Alert */}
            {error && (
              <div className="px-6 mb-2">
                <Alert type="error" message={error} showIcon closable onClose={() => setError('')} />
              </div>
            )}

            {/* Generate Footer - 底部固定 */}
            <div className="mt-auto px-6 pb-6 pt-2 border-t border-gray-50 bg-white sticky bottom-0">
              <div className="flex items-center justify-between mb-2">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('estimatedCost', { credits: 2 })}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('currentBalance', { balance: balance.toLocaleString() })}
                </Typography.Text>
              </div>
              <Form.Item className="!mb-0">
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={generating}
                  style={{ height: 46, borderRadius: 10, fontWeight: 600 }}
                >
                  {generateStep === 'uploading'
                    ? t('generatingWithUpload')
                    : generating
                      ? t('generatingNow')
                      : t('startGenerate')}
                </Button>
              </Form.Item>
            </div>
          </Form>
        </div>

        {/* ================================================================ */}
        {/* Preview Panel                                                     */}
        {/* ================================================================ */}
        <div
          className="flex-1 overflow-y-auto bg-gray-50/30"
          style={{ padding: 24 }}
        >
          <div
            className="bg-white rounded-xl border border-gray-100 flex flex-col min-h-full"
            style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)' }}
          >
            {/* ---- Empty State ---- */}
            {previewState === 'empty' && (
              <div className="flex-1 flex flex-col items-center justify-center py-20 px-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                  <PictureOutlined className="text-2xl text-gray-300" />
                </div>
                <Typography.Title level={5} className="!mb-1 !text-gray-700">
                  {t('emptyTitle')}
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {t('emptyHint')}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }} className="mt-1">
                  {t('emptyHintSub')}
                </Typography.Text>
              </div>
            )}

            {/* ---- Generating State ---- */}
            {previewState === 'generating' && selectedTask && (
              <div className="flex-1 flex flex-col items-center justify-center py-20 px-8 text-center">
                <div className="w-14 h-14 rounded-full border-4 border-primary-100 border-t-primary-600 animate-spin mb-5" />
                <Typography.Title level={5} className="!mb-1 !text-gray-700">
                  {t('generatingHint')}
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {t('generatingHintSub')}
                </Typography.Text>
                <div className="mt-6 w-full max-w-xs space-y-2">
                  <Skeleton.Image active style={{ width: '100%', height: 160, borderRadius: 12 }} />
                  <Skeleton active paragraph={{ rows: 1 }} />
                </div>
              </div>
            )}

            {/* ---- Success State ---- */}
            {previewState === 'success' && selectedTask && (
              <div className="flex-1 flex flex-col p-4">
                {/* Result Image */}
                <div className="flex items-center justify-center mb-3">
                  <AntdImage
                    src={displayUrl(selectedTask)}
                    alt={selectedTask.prompt || t('generatedImage')}
                    className="rounded-xl border border-gray-100 object-contain max-h-[70vh] bg-gray-50 cursor-zoom-in"
                    preview={{ mask: false }}
                    style={{ maxWidth: '100%' }}
                  />
                </div>

                {/* Action Bar */}
                <div className="flex items-center justify-center gap-1 mt-3">
                  <Tooltip title={t('download')}>
                    <Button
                      type="text"
                      size="small"
                      className="!w-9 !h-9 !min-w-9 flex items-center justify-center !text-gray-500 hover:!text-gray-900"
                      onClick={() => displayUrl(selectedTask) && downloadImage(displayUrl(selectedTask))}
                      aria-label={t('download')}
                    >
                      <DownloadOutlined />
                    </Button>
                  </Tooltip>
                  <Tooltip title={t('regenerate')}>
                    <Button
                      type="text"
                      size="small"
                      className="!w-9 !h-9 !min-w-9 flex items-center justify-center !text-gray-500 hover:!text-gray-900"
                      onClick={() => regenerateFromTask(selectedTask)}
                      aria-label={t('regenerate')}
                    >
                      <ReloadOutlined />
                    </Button>
                  </Tooltip>
                  <Tooltip title={t('continueEdit')}>
                    <Button
                      type="text"
                      size="small"
                      className="!w-9 !h-9 !min-w-9 flex items-center justify-center !text-gray-500 hover:!text-gray-900"
                      onClick={() => fillFormFromTask(selectedTask)}
                      aria-label={t('continueEdit')}
                    >
                      <EditOutlined />
                    </Button>
                  </Tooltip>
                  <Tooltip title={t('copyPrompt')}>
                    <Button
                      type="text"
                      size="small"
                      className="!w-9 !h-9 !min-w-9 flex items-center justify-center !text-gray-500 hover:!text-gray-900"
                      onClick={() => copyPrompt(selectedTask.prompt)}
                      aria-label={t('copyPrompt')}
                    >
                      <CopyOutlined />
                    </Button>
                  </Tooltip>
                  <Divider type="vertical" className="!mx-1" />
                  <Tooltip title={t('delete')}>
                    <Button
                      type="text"
                      size="small"
                      className="!w-9 !h-9 !min-w-9 flex items-center justify-center !text-gray-500 hover:!text-rose-600"
                      onClick={() => {
                        setHistory((prev) => prev.filter((t) => t.id !== selectedTask.id))
                        setSelectedTaskId(null)
                      }}
                      aria-label={t('delete')}
                    >
                      <DeleteOutlined />
                    </Button>
                  </Tooltip>
                </div>

                {/* Params Section */}
                <div className="mt-4 pt-3 border-t border-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <Typography.Text type="secondary" style={{ fontSize: 12 }} strong>
                      {t('params')}
                    </Typography.Text>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t('prompt')}
                      </Typography.Text>
                      <p className="text-gray-800 mt-0.5 leading-relaxed">
                        {selectedTask.prompt || '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-4 pt-1">
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('mode')}:{' '}
                        </Typography.Text>
                        <Typography.Text style={{ fontSize: 12 }}>
                          {modeLabel(selectedTask.mode)}
                        </Typography.Text>
                      </div>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('size')}:{' '}
                        </Typography.Text>
                        <Typography.Text style={{ fontSize: 12 }}>
                          {formatSizeRatioLabel(selectedTask.size, selectedTask.ratio)}
                        </Typography.Text>
                      </div>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('model')}:{' '}
                        </Typography.Text>
                        <Typography.Text style={{ fontSize: 12 }}>
                          {modelDisplayName(selectedTask.model)}
                        </Typography.Text>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---- Error State ---- */}
            {previewState === 'error' && selectedTask && (
              <div className="flex-1 flex flex-col items-center justify-center py-20 px-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center mb-4">
                  <ExclamationCircleOutlined className="text-2xl text-rose-400" />
                </div>
                <Typography.Title level={5} className="!mb-1 !text-gray-700">
                  {t('generateFailed')}
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 13 }} className="max-w-sm block">
                  {t('generateFailedHint')}
                </Typography.Text>
                <Button
                  type="primary"
                  className="mt-5"
                  style={{ height: 40, borderRadius: 10 }}
                  onClick={() => regenerateFromTask(selectedTask)}
                  icon={<ReloadOutlined />}
                >
                  {t('regenerateBtn')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}