'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Button,
  Collapse,
  Divider,
  Form,
  Input,
  InputNumber,
  Image as AntdImage,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SwapOutlined,
  ArrowUpOutlined,
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
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'
import {
  VIDEO_MODELS,
  VIDEO_FRAME_PRESETS,
  VIDEO_RESOLUTION_PRESETS,
  DEFAULT_VIDEO_MODEL,
  modelDisplayName,
} from '../../lib/models'
import GenerationWorkspaceChrome from './GenerationWorkspaceChrome'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 新架构统一状态：PENDING/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED */
const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING']
const TITLE_PENDING = 'PENDING'

/** 上传图片允许的格式 */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** 单张上传图片大小上限（10 MB） */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024

/** Prompt 最大字符数 */
const MAX_PROMPT_LENGTH = 2000

/** 画面比例选项 */
const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9', icon: 'horizontal' },
  { id: '9:16', label: '9:16', icon: 'vertical' },
  { id: '1:1', label: '1:1', icon: 'square' },
] as const

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type GenerationMode = 'text2video' | 'img2video'

interface VideoTask extends TaskItem {
  status: string
  prompt?: string
  negative_prompt?: string
  mode?: string
  model?: string
  title?: string
  title_generation_status?: string
  width?: number
  height?: number
  num_frames?: number
  frame_rate?: number
  seed?: number | string | null
  input_images?: string[]
  output_url?: string
  progress?: number
  error_message?: unknown
  created_at?: string
}

interface VideoFormValues {
  model: string
  mode: string
  prompt: string
  negative_prompt: string
  resolution: string
  num_frames: number
  frame_rate: number
  seed: number | null
}

interface InputImage {
  file?: File
  preview: string
}

type PreviewState = 'empty' | 'generating' | 'success' | 'error'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 将后端 Generation 归一化为视图所需的 VideoTask。 */
function toVideoTask(g: Generation): VideoTask {
  const input = (g.input ?? {}) as Record<string, unknown>
  const images = input.images ?? input.image
  return {
    id: g.id,
    status: g.status,
    title: g.title,
    title_generation_status: g.titleGenerationStatus,
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
    progress: typeof g.output?.progress === 'number' ? g.output.progress : undefined,
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


function getInitialResolutionId(): string {
  const match = VIDEO_RESOLUTION_PRESETS.find((p) => p.width === 1280 && p.height === 720)
  return match?.id || '720p-h'
}

/** 根据比例获取分辨率预设 id */
function ratioToResolutionId(ratio: string): string {
  if (ratio === '9:16') return '720p-v'
  if (ratio === '1:1') return '720p-h'
  return '720p-h'
}

/** 判断 Preview 状态 */
function getPreviewState(task: VideoTask | null, generating: boolean): PreviewState {
  if (!task) return 'empty'
  if (ACTIVE_STATUSES.includes(task.status) || generating) return 'generating'
  if (task.status === 'FAILED' || task.status === 'CANCELED') return 'error'
  if (displayUrl(task)) return 'success'
  return 'empty'
}

/** 根据 numFrames + frameRate 自动计算 frames */
function autoCalcFrames(durationLabel: string): { numFrames: number; frameRate: number } {
  const preset = VIDEO_FRAME_PRESETS.find((p) => p.label === durationLabel)
  return preset ?? { numFrames: 121, frameRate: 24 }
}

// ---------------------------------------------------------------------------
// 比例图标组件
// ---------------------------------------------------------------------------

function RatioIcon({ type }: { type: 'horizontal' | 'vertical' | 'square' }) {
  const styles: Record<string, React.CSSProperties> = {
    horizontal: { width: 20, height: 12 },
    vertical: { width: 12, height: 20 },
    square: { width: 16, height: 16 },
  }
  return (
    <span
      style={{
        ...styles[type],
        display: 'inline-block',
        border: '2px solid currentColor',
        borderRadius: 3,
      }}
    />
  )
}

// ===========================================================================
// 主组件
// ===========================================================================

export default function VideoView() {
  const t = useTranslations('video')
  const tc = useTranslations()
  const { alert } = useDialog()
  const { hasActiveKey, keyStatusLoading, refreshKeyStatus, requireApiKey } = useApiKeyGuard()
  const { balance } = useSession()

  const [form] = Form.useForm<VideoFormValues>()
  const [inputImages, setInputImages] = useState<InputImage[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const [error, setError] = useState('')
  const [currentMode, setCurrentMode] = useState<GenerationMode>('text2video')
  const [promptValue, setPromptValue] = useState('')
  const [selectedDurationLabel, setSelectedDurationLabel] = useState<string>('5s')
  const [selectedRatio, setSelectedRatio] = useState<string>('16:9')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 监听表单中 num_frames 变化
  const watchedNumFrames = Form.useWatch<number>('num_frames', form)
  useEffect(() => {
    if (watchedNumFrames == null) return
    const matched = VIDEO_FRAME_PRESETS.find((p) => p.numFrames === watchedNumFrames)
    if (matched) {
      setSelectedDurationLabel(matched.label)
    }
  }, [watchedNumFrames])

  const { history, resetHistory, setHistory } = usePaginatedTaskHistory(
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

  const previewState = useMemo(
    () => getPreviewState(selectedTask, submitting),
    [selectedTask, submitting],
  )

  const revokePreview = useCallback((item: InputImage) => {
    if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview)
  }, [])

  // ---- 任务过滤已移至历史记录页面 ----

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
        (t) => (ACTIVE_STATUSES.includes(t.status) || t.title_generation_status === TITLE_PENDING) && !String(t.id).startsWith('temp-'),
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

  // ---- 文件校验 ----
  const validateFile = useCallback(
    (file: File): string | null => {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        return t('uploadHint')
      }
      if (file.size > MAX_UPLOAD_SIZE) {
        return `${file.name} > 10MB`
      }
      return null
    },
    [t],
  )

  // ---- 单图上传处理（图生视频模式仅支持单图）----
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

  // ---- 模式切换 ----
  const handleModeChange = useCallback(
    (mode: string) => {
      setCurrentMode(mode as GenerationMode)
      form.setFieldValue('mode', mode)
      if (mode === 'text2video' && inputImages.length > 0) {
        inputImages.forEach(revokePreview)
        setInputImages([])
      }
    },
    [form, inputImages, revokePreview],
  )

  // ---- 画面比例切换 ----
  const handleRatioChange = useCallback(
    (ratio: string) => {
      setSelectedRatio(ratio)
      const resolutionId = ratioToResolutionId(ratio)
      form.setFieldValue('resolution', resolutionId)
    },
    [form],
  )

  // ---- 时长切换 ----
  const handleDurationChange = useCallback(
    (label: string) => {
      setSelectedDurationLabel(label)
      const { numFrames, frameRate } = autoCalcFrames(label)
      form.setFieldsValue({ num_frames: numFrames, frame_rate: frameRate })
    },
    [form],
  )

  // ---- 生成 ----
  const generate = useCallback(
    async (values: VideoFormValues) => {
      if (!values.prompt.trim()) {
        setError(t('promptRequired'))
        return
      }
      if (values.mode === 'img2video' && !inputImages.length) {
        setError(t('uploadImageRequired'))
        return
      }
      if (!(await requireApiKey())) return

      setError('')
      setSubmitting(true)

      const preset = VIDEO_RESOLUTION_PRESETS.find((p) => p.id === values.resolution)
      const width = preset?.width ?? 1280
      const height = preset?.height ?? 720

      const tempId = `temp-${Date.now()}`
      const optimisticInputImages =
        values.mode === 'img2video' && inputImages.length
          ? [inputImages[0].preview]
          : undefined

      const optimisticTask: VideoTask = {
        id: tempId,
        status: 'PENDING',
        prompt: values.prompt,
        negative_prompt: values.negative_prompt || undefined,
        mode: values.mode,
        width,
        height,
        num_frames: values.num_frames,
        frame_rate: values.frame_rate,
        seed: values.seed,
        input_images: optimisticInputImages,
        _optimistic: true,
      }
      setHistory((prev) => [optimisticTask, ...prev])
      setSelectedTaskId(tempId)

      try {
        let imageUrl: string | undefined
        if (values.mode === 'img2video' && inputImages.length) {
          const urls = await uploadLocalFiles([inputImages[0]])
          imageUrl = urls[0]
        }

        const input: Record<string, unknown> = {
          model: values.model,
          prompt: values.prompt,
          mode: values.mode,
          width,
          height,
          numFrames: values.num_frames,
          frameRate: values.frame_rate,
        }
        if (values.negative_prompt) input.negativePrompt = values.negative_prompt
        if (values.seed != null) input.seed = values.seed
        if (values.mode === 'img2video' && imageUrl) {
          input.image = imageUrl
        }

        const payload: CreateGenerationPayload = {
          type: 'VIDEO',
          provider: 'agnes',
          model: values.model,
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
    },
    [
      inputImages,
      requireApiKey,
      setHistory,
      startPollingAll,
      alert,
      taskErrorMessage,
      t,
      uploadLocalFiles,
    ],
  )

  const fillFormFromTask = useCallback(
    (task: VideoTask) => {
      if (!task || task._optimistic) return
      const resolutionId = (() => {
        const match = VIDEO_RESOLUTION_PRESETS.find(
          (p) => p.width === task.width && p.height === task.height,
        )
        return match?.id || '720p-h'
      })()
      form.setFieldsValue({
        model: task.model || DEFAULT_VIDEO_MODEL,
        mode: task.mode || 'text2video',
        prompt: task.prompt || '',
        negative_prompt: task.negative_prompt || '',
        resolution: resolutionId,
        num_frames: task.num_frames ?? 121,
        frame_rate: task.frame_rate ?? 24,
        seed: (task.seed ?? null) as number | null,
      })
      setPromptValue(task.prompt || '')
      setCurrentMode((task.mode as GenerationMode) || 'text2video')
      const matchedPreset = VIDEO_FRAME_PRESETS.find(
        (p) => p.numFrames === (task.num_frames ?? 121) && p.frameRate === (task.frame_rate ?? 24),
      )
      setSelectedDurationLabel(matchedPreset?.label ?? '5s')
      // 推断比例
      if (task.width && task.height) {
        if (task.width > task.height) setSelectedRatio('16:9')
        else if (task.height > task.width) setSelectedRatio('9:16')
        else setSelectedRatio('1:1')
      }
      inputImages.forEach(revokePreview)
      setInputImages(inputImagesOf(task).map((url) => ({ preview: url })))
      setError('')
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [form, revokePreview, inputImages],
  )

  // ---- 复制提示词 ----
  const copyPrompt = useCallback(async (prompt?: string) => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      // fallback
    }
  }, [])

  // ---- 下载视频 ----
  const downloadVideo = useCallback(async (url: string, name?: string) => {
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = name || `enova-video-${Date.now()}.mp4`
      a.target = '_blank'
      a.click()
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  // ---- 再次生成 ----
  const regenerateFromTask = useCallback(
    (task: VideoTask) => {
      fillFormFromTask(task)
      form.submit()
    },
    [fillFormFromTask, form],
  )

  // ---- 历史项右键菜单已移至历史记录页面 ----

  // ---- Initial load ----
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

  // ---- Cleanup polling on unmount ----
  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // ---- cleanup blob urls ----
  useEffect(() => {
    return () => {
      inputImages.forEach(revokePreview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Segmented 模式选项 ----
  const modeOptions = useMemo(
    () => [
      { value: 'text2video', label: t('textToVideo') },
      { value: 'img2video', label: t('imageToVideo') },
    ],
    [t],
  )

  // ---- 自动计算的帧数（只读展示）----
  const autoFrames = useMemo(() => autoCalcFrames(selectedDurationLabel).numFrames, [selectedDurationLabel])

  // ---- 预计 Credits ----
  const estimatedCredits = 10
  const insufficientCredits = balance < estimatedCredits

  return (
    <div className={`relative flex h-full overflow-hidden video-unified-workspace ${settingsOpen ? 'video-settings-open' : ''}`} style={{ backgroundColor: '#F7F8FA' }}>
      <GenerationWorkspaceChrome
        mode="video"
        tasks={history.map((task) => ({ id: task.id, title: task.title || '未命名对话', status: task.status }))}
        selectedTaskId={selectedTaskId}
        onNewConversation={() => { form.resetFields(); setSelectedTaskId(null); setInputImages([]); setError('') }}
        onSelectTask={(id) => setSelectedTaskId(id)}
      />
      {/* ================================================================ */}
      {/* Workspace (两栏布局: 配置 + 预览)                                */}
      {/* ================================================================ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ================================================================ */}
        {/* Create Panel (~47%)                                              */}
        {/* ================================================================ */}
        <div
          ref={formCardRef}
          className="video-legacy-settings flex-shrink-0 flex flex-col overflow-y-auto bg-white border-r"
          style={{ borderColor: '#EAECF0', width: '47%' }}
        >
        <Form
          form={form}
          layout="vertical"
          onFinish={generate}
          initialValues={{
            model: DEFAULT_VIDEO_MODEL,
            mode: 'text2video',
            prompt: '',
            negative_prompt: '',
            resolution: getInitialResolutionId(),
            num_frames: 121,
            frame_rate: 24,
            seed: null,
          }}
          className="flex flex-col h-full"
          requiredMark={false}
        >
          {/* ---- Page Header ---- */}
          <div className="px-6 pt-6 pb-4">
            <Typography.Title level={3} className="!mb-1" style={{ fontSize: 24, fontWeight: 600, color: '#101828' }}>
              {t('title')}
            </Typography.Title>
            <Typography.Text style={{ fontSize: 13, color: '#667085' }}>
              {t('subtitle')}
            </Typography.Text>
          </div>

          {/* ---- API Key Warning ---- */}
          {!keyStatusLoading && !hasActiveKey && (
            <div className="px-6 mb-2">
              <Alert
                type="warning"
                showIcon
                message={
                  <span>
                    {t('insufficientBalance')}{' '}
                    <Link href="/app/wallet" style={{ color: '#0F9F91' }}>
                      {tc('common.wallet')}
                    </Link>
                    {t('rechargeHint')}
                  </span>
                }
              />
            </div>
          )}

          {/* ---- Mode Segmented ---- */}
          <div className="px-6 mb-5">
            <Segmented
              block
              value={currentMode}
              onChange={(val) => handleModeChange(val as string)}
              options={modeOptions}
            />
          </div>

          <Form.Item name="mode" hidden>
            <Input />
          </Form.Item>

          {/* ---- Prompt Composer ---- */}
          <div className="px-6 mb-5">
            <div className="flex items-center justify-between mb-2">
              <Typography.Text strong className="!text-sm" style={{ color: '#101828' }}>
                {t('promptLabel')}
              </Typography.Text>
              <Button
                type="text"
                size="small"
                className="!text-xs"
                style={{ color: '#0F9F91' }}
                aria-label={t('optimizePrompt')}
              >
                {t('optimizePrompt')}
              </Button>
            </div>
            <Form.Item name="prompt" className="!mb-0">
              <Input.TextArea
                autoSize={{ minRows: 5, maxRows: 10 }}
                placeholder={t('promptComposerPlaceholder')}
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                maxLength={MAX_PROMPT_LENGTH}
                className="!resize-none"
                aria-label={t('promptLabel')}
                style={{ borderRadius: 12 }}
              />
            </Form.Item>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-3">
                <Button
                  type="text"
                  size="small"
                  className="!text-xs"
                  style={{ color: '#667085' }}
                >
                  {t('optimizePrompt')}
                </Button>
                <Button
                  type="text"
                  size="small"
                  className="!text-xs"
                  style={{ color: '#667085' }}
                >
                  {t('randomInspiration')}
                </Button>
              </div>
              <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                {t('promptCount', { count: promptValue.length })}
              </Typography.Text>
            </div>
          </div>

          {/* ---- Image Upload Area (仅图生视频) ---- */}
          {currentMode === 'img2video' && (
            <div className="px-6 mb-5">
              <Typography.Text strong className="!text-sm block mb-2" style={{ color: '#101828' }}>
                {t('uploadReferenceImage')}
              </Typography.Text>
              {inputImages.length === 0 ? (
                <Upload.Dragger
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  showUploadList={false}
                  beforeUpload={(file) => {
                    handleSingleUpload(file)
                    return false
                  }}
                  className="!bg-gray-50/50 !border-dashed"
                  style={{
                    borderRadius: 12,
                    borderColor: '#EAECF0',
                    minHeight: 160,
                    padding: '8px 0',
                  }}
                >
                  <div className="flex flex-col items-center py-6">
                    <InboxOutlined className="text-2xl mb-2" style={{ color: '#D0D5DD' }} />
                    <p className="text-sm" style={{ color: '#667085' }}>
                      {t('uploadReferenceImage')}
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#98A2B3' }}>
                      {t('uploadHint')}
                    </p>
                  </div>
                </Upload.Dragger>
              ) : (
                <div className="relative group inline-block w-full">
                  <AntdImage
                    src={inputImages[0].preview}
                    alt={t('uploadReferenceImage')}
                    width="100%"
                    height={160}
                    preview={false}
                    className="object-cover rounded-xl"
                    style={{ border: '1px solid #EAECF0', borderRadius: 12 }}
                  />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip title={t('replaceImage')}>
                      <Button
                        type="primary"
                        size="small"
                        className="!w-7 !h-7 !min-w-7 !p-0 flex items-center justify-center"
                        onClick={() => replaceInputImage(0)}
                        aria-label={t('replaceImage')}
                      >
                        <SwapOutlined />
                      </Button>
                    </Tooltip>
                    <Tooltip title={t('deleteImage')}>
                      <Button
                        size="small"
                        className="!w-7 !h-7 !min-w-7 !p-0 flex items-center justify-center"
                        onClick={() => removeInputImage(0)}
                        aria-label={t('deleteImage')}
                      >
                        <DeleteOutlined />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Model Selector ---- */}
          <div className="px-6 mb-5">
            <Typography.Text strong className="!text-sm block mb-2" style={{ color: '#101828' }}>
              {t('model')}
            </Typography.Text>
            <Form.Item name="model" className="!mb-0">
              <Select
                options={VIDEO_MODELS.map((m) => ({
                  value: m.apiId,
                  label: (
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium" style={{ color: '#101828' }}>
                          {m.name}
                        </span>
                        <span className="text-xs" style={{ color: '#98A2B3' }}>
                          {m.tagline}
                        </span>
                      </div>
                      {m.apiId === DEFAULT_VIDEO_MODEL && (
                        <Tag color="green" className="!m-0 !text-[10px] !rounded-full">
                          {t('modelRecommended')}
                        </Tag>
                      )}
                    </div>
                  ),
                }))}
              />
            </Form.Item>
          </div>

          <Form.Item name="resolution" hidden>
            <Input />
          </Form.Item>

          {/* ---- Aspect Ratio ---- */}
          <div className="px-6 mb-5">
            <Typography.Text strong className="!text-sm block mb-2" style={{ color: '#101828' }}>
              {t('aspectRatio')}
            </Typography.Text>
            <Segmented
              value={selectedRatio}
              onChange={(val) => handleRatioChange(val as string)}
              options={ASPECT_RATIOS.map((r) => ({
                value: r.id,
                label: (
                  <div className="flex items-center gap-2">
                    <RatioIcon type={r.icon} />
                    <span className="text-sm">{r.label}</span>
                  </div>
                ),
              }))}
            />
          </div>

          {/* ---- Duration ---- */}
          <div className="px-6 mb-5">
            <Typography.Text strong className="!text-sm block mb-2" style={{ color: '#101828' }}>
              {t('durationLabel2')}
            </Typography.Text>
            <Segmented
              value={selectedDurationLabel}
              onChange={(val) => handleDurationChange(val as string)}
              options={VIDEO_FRAME_PRESETS.map((p) => ({
                value: p.label,
                label: <span className="text-sm">{p.label}</span>,
              }))}
            />
            <Typography.Text className="block mt-2" style={{ fontSize: 12, color: '#98A2B3' }}>
              {t('framesLabel')}: {autoFrames} · {t('frameRateLabel')}: 24 fps
            </Typography.Text>
          </div>

          {/* Hidden form fields for auto-calculated values */}
          <Form.Item name="num_frames" hidden>
            <InputNumber />
          </Form.Item>
          <Form.Item name="frame_rate" hidden>
            <InputNumber />
          </Form.Item>

          {/* ---- Advanced Settings ---- */}
          <div className="px-6 mb-5">
            <Divider className="!my-2" style={{ borderColor: '#EAECF0' }} />
            <Collapse
              ghost
              activeKey={advancedOpen ? ['adv'] : []}
              onChange={() => setAdvancedOpen(!advancedOpen)}
              className="!bg-transparent"
              style={{ padding: 0 }}
              items={[
                {
                  key: 'adv',
                  label: (
                    <Typography.Text className="!text-sm" style={{ color: '#667085' }}>
                      {t('advancedSettings')}
                    </Typography.Text>
                  ),
                  children: (
                    <div className="space-y-4 pt-2">
                      {/* Negative Prompt */}
                      <Form.Item
                        label={t('negativePrompt')}
                        name="negative_prompt"
                        className="!mb-0"
                      >
                        <Input.TextArea
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          placeholder={t('negativePromptPlaceholder')}
                          style={{ borderRadius: 10 }}
                        />
                      </Form.Item>

                      {/* Resolution */}
                      <Form.Item
                        label={t('resolution')}
                        name="resolution"
                        className="!mb-0"
                      >
                        <Select
                          options={VIDEO_RESOLUTION_PRESETS.map((p) => ({
                            value: p.id,
                            label: `${p.label} (${p.width}×${p.height})`,
                          }))}
                        />
                      </Form.Item>

                      {/* Seed */}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Typography.Text style={{ fontSize: 13, color: '#667085' }}>
                            {t('seed')}
                          </Typography.Text>
                          <Tooltip title={t('seedTooltip')}>
                            <ExclamationCircleOutlined style={{ color: '#D0D5DD', fontSize: 12 }} />
                          </Tooltip>
                        </div>
                        <Form.Item name="seed" className="!mb-0">
                          <InputNumber
                            className="w-full"
                            placeholder={t('seedPlaceholder')}
                            style={{ borderRadius: 10 }}
                          />
                        </Form.Item>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          {/* ---- Error Alert ---- */}
          {error && (
            <div className="px-6 mb-2">
              <Alert
                type="error"
                message={error}
                showIcon
                closable
                onClose={() => setError('')}
              />
            </div>
          )}

          {/* ---- Generate Footer (Sticky Bottom) ---- */}
          <div
            className="mt-auto px-6 pb-6 pt-3 border-t bg-white"
            style={{ borderColor: '#EAECF0' }}
          >
            {/* Credits info */}
            <div className="flex items-center justify-between mb-3">
              <Typography.Text style={{ fontSize: 12, color: '#667085' }}>
                {t('estimatedCredits', { credits: estimatedCredits })}
              </Typography.Text>
              <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                {tc('common.balance')}: {balance.toLocaleString()}
              </Typography.Text>
            </div>
            {insufficientCredits && (
              <Alert
                type="warning"
                message={t('insufficientCredits')}
                showIcon
                className="!mb-3"
              />
            )}
            <Form.Item className="!mb-0">
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={submitting}
                disabled={insufficientCredits}
                style={{
                  height: 46,
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {submitting
                  ? t('submittingTask')
                  : t('generateVideo', { credits: estimatedCredits })}
              </Button>
            </Form.Item>
          </div>
        </Form>
      </div>

      {/* ================================================================ */}
      {/* Preview Panel (flex: 1)                                           */}
      {/* ================================================================ */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ backgroundColor: '#F7F8FA', padding: 24 }}
      >
        <div
          className="bg-white rounded-xl flex flex-col min-h-full"
          style={{
            border: '1px solid #EAECF0',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
          }}
        >
          {/* ---- Empty State ---- */}
          {previewState === 'empty' && (
            <div className="flex-1 flex flex-col items-center justify-center py-20 px-8 text-center">
              {/* 16:9 Preview Canvas Placeholder */}
              <div
                className="w-full max-w-2xl rounded-xl flex flex-col items-center justify-center"
                style={{
                  aspectRatio: '16 / 9',
                  backgroundColor: '#F7F8FA',
                  border: '1px solid #EAECF0',
                }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: '#fff', border: '1px solid #EAECF0' }}
                >
                  <PlayCircleOutlined style={{ fontSize: 24, color: '#D0D5DD' }} />
                </div>
                <Typography.Title level={5} className="!mb-1" style={{ color: '#101828' }}>
                  {t('previewEmptyTitle')}
                </Typography.Title>
                <Typography.Text style={{ fontSize: 13, color: '#98A2B3' }}>
                  {t('previewEmptyHint')}
                </Typography.Text>
              </div>
            </div>
          )}

          {/* ---- Generating State ---- */}
          {previewState === 'generating' && selectedTask && (
            <div className="flex-1 flex flex-col items-center justify-center py-20 px-8 text-center">
              <div
                className="w-full max-w-2xl rounded-xl flex flex-col items-center justify-center"
                style={{
                  aspectRatio: '16 / 9',
                  backgroundColor: '#F7F8FA',
                  border: '1px solid #EAECF0',
                }}
              >
                {/* Skeleton loading */}
                <Skeleton.Image
                  active
                  style={{ width: '80%', height: '60%', borderRadius: 12 }}
                />
                <div className="mt-6 text-center">
                  <div
                    className="w-10 h-10 rounded-full border-4 animate-spin mx-auto mb-4"
                    style={{
                      borderColor: '#0F9F91',
                      borderTopColor: 'transparent',
                    }}
                  />
                  <Typography.Title level={5} className="!mb-1" style={{ color: '#101828' }}>
                    {t('previewGeneratingTitle')}
                  </Typography.Title>
                  <Typography.Text style={{ fontSize: 13, color: '#98A2B3' }}>
                    {t('previewGeneratingHint')}
                  </Typography.Text>
                  {selectedTask.progress != null && (
                    <div className="mt-4 w-48 mx-auto">
                      <div
                        className="w-full h-2 rounded-full overflow-hidden"
                        style={{ backgroundColor: '#F7F8FA' }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(0, selectedTask.progress))}%`,
                            backgroundColor: '#0F9F91',
                          }}
                        />
                      </div>
                      <p className="text-sm mt-2" style={{ color: '#667085' }}>
                        {selectedTask.progress}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---- Success State ---- */}
          {previewState === 'success' && selectedTask && (
            <div className="flex-1 flex flex-col p-4">
              {/* Video Player */}
              <div className="flex items-center justify-center mb-3">
                <video
                  src={displayUrl(selectedTask)}
                  controls
                  autoPlay
                  loop
                  className="rounded-xl"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '60vh',
                    border: '1px solid #EAECF0',
                  }}
                />
              </div>

              {/* Reference Image (if exists) */}
              {inputImagesOf(selectedTask).length > 0 && (
                <div className="mb-3">
                  <Typography.Text className="block mb-2" style={{ fontSize: 12, color: '#98A2B3' }}>
                    {t('referenceImagesLabel')}
                  </Typography.Text>
                  <div className="flex flex-wrap gap-2">
                    {inputImagesOf(selectedTask).map((url, i) => (
                      <AntdImage
                        key={i}
                        src={url}
                        alt={t('referenceImagesLabel')}
                        width={80}
                        height={80}
                        preview={{ mask: false }}
                        className="object-cover rounded-xl"
                        style={{ border: '1px solid #EAECF0' }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Action Bar */}
              <div className="flex items-center justify-center gap-1 mt-2">
                <Tooltip title={t('downloadVideo')}>
                  <Button
                    type="text"
                    size="small"
                    className="!w-9 !h-9 !min-w-9 flex items-center justify-center"
                    style={{ color: '#667085' }}
                    onClick={() => displayUrl(selectedTask) && downloadVideo(displayUrl(selectedTask))}
                    aria-label={t('downloadVideo')}
                  >
                    <DownloadOutlined />
                  </Button>
                </Tooltip>
                <Tooltip title={t('regenerateVideo')}>
                  <Button
                    type="text"
                    size="small"
                    className="!w-9 !h-9 !min-w-9 flex items-center justify-center"
                    style={{ color: '#667085' }}
                    onClick={() => regenerateFromTask(selectedTask)}
                    aria-label={t('regenerateVideo')}
                  >
                    <ReloadOutlined />
                  </Button>
                </Tooltip>
                <Tooltip title={t('createVariation')}>
                  <Button
                    type="text"
                    size="small"
                    className="!w-9 !h-9 !min-w-9 flex items-center justify-center"
                    style={{ color: '#667085' }}
                    onClick={() => fillFormFromTask(selectedTask)}
                    aria-label={t('createVariation')}
                  >
                    <CopyOutlined />
                  </Button>
                </Tooltip>
                <Tooltip title={t('copyParams')}>
                  <Button
                    type="text"
                    size="small"
                    className="!w-9 !h-9 !min-w-9 flex items-center justify-center"
                    style={{ color: '#667085' }}
                    onClick={() => copyPrompt(selectedTask.prompt)}
                    aria-label={t('copyParams')}
                  >
                    <CopyOutlined />
                  </Button>
                </Tooltip>
              </div>

              {/* Params Section */}
              <div className="mt-4 pt-3" style={{ borderTop: '1px solid #EAECF0' }}>
                <div className="flex items-center justify-between mb-2">
                  <Typography.Text strong style={{ fontSize: 12, color: '#667085' }}>
                    {t('params')}
                  </Typography.Text>
                  <Button
                    type="text"
                    size="small"
                    className="!text-xs"
                    style={{ color: '#0F9F91' }}
                    onClick={() => fillFormFromTask(selectedTask)}
                  >
                    {t('fillForm')}
                  </Button>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div>
                    <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                      {t('prompt')}
                    </Typography.Text>
                    <p className="mt-0.5 leading-relaxed" style={{ color: '#101828' }}>
                      {selectedTask.prompt || '—'}
                    </p>
                  </div>
                  {selectedTask.negative_prompt && (
                    <div>
                      <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                        {t('negativePromptLabel')}
                      </Typography.Text>
                      <p className="mt-0.5 leading-relaxed" style={{ color: '#667085' }}>
                        {selectedTask.negative_prompt}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-4 pt-1">
                    <div>
                      <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                        {t('resolutionLabel')}:{' '}
                      </Typography.Text>
                      <Typography.Text style={{ fontSize: 12, color: '#101828' }}>
                        {formatResolution(selectedTask)}
                      </Typography.Text>
                    </div>
                    <div>
                      <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                        {t('durationLabel')}:{' '}
                      </Typography.Text>
                      <Typography.Text style={{ fontSize: 12, color: '#101828' }}>
                        {formatDuration(selectedTask)}
                      </Typography.Text>
                    </div>
                    <div>
                      <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                        {t('modelLabel')}:{' '}
                      </Typography.Text>
                      <Typography.Text style={{ fontSize: 12, color: '#101828' }}>
                        {modelDisplayName(selectedTask.model)}
                      </Typography.Text>
                    </div>
                    <div>
                      <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                        {t('seedLabel')}:{' '}
                      </Typography.Text>
                      <Typography.Text style={{ fontSize: 12, color: '#101828' }} className="font-mono">
                        {selectedTask.seed != null && selectedTask.seed !== ''
                          ? selectedTask.seed
                          : t('random')}
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
              <div
                className="w-full max-w-2xl rounded-xl flex flex-col items-center justify-center"
                style={{
                  aspectRatio: '16 / 9',
                  backgroundColor: '#F7F8FA',
                  border: '1px solid #EAECF0',
                }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: '#fff', border: '1px solid #FEF3C7' }}
                >
                  <ExclamationCircleOutlined style={{ fontSize: 24, color: '#F59E0B' }} />
                </div>
                <Typography.Title level={5} className="!mb-1" style={{ color: '#101828' }}>
                  {t('previewFailed')}
                </Typography.Title>
                <Typography.Text className="max-w-sm block" style={{ fontSize: 13, color: '#98A2B3' }}>
                  {taskErrorMessage(selectedTask) || t('previewFailedHint')}
                </Typography.Text>
                <Button
                  type="primary"
                  className="mt-5"
                  style={{ height: 40, borderRadius: 10 }}
                  onClick={() => regenerateFromTask(selectedTask)}
                  icon={<ReloadOutlined />}
                >
                  {t('retryGenerate')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="video-unified-composer">
        <div className="mb-2">
          <Input.TextArea value={promptValue} onChange={(event) => { setPromptValue(event.target.value); form.setFieldValue('prompt', event.target.value) }} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); form.submit() } }} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={t('promptComposerPlaceholder')} maxLength={MAX_PROMPT_LENGTH} className="!resize-none" />
        </div>
        {inputImages.length > 0 && <div className="video-composer-reference">已添加 {inputImages.length} 张参考图</div>}
        <div className="video-composer-toolbar">
          <Segmented size="small" value={currentMode} options={modeOptions} onChange={(value) => handleModeChange(value as GenerationMode)} />
          <Button type="text" size="small" onClick={() => setSettingsOpen((value) => !value)}>{settingsOpen ? '收起参数' : '参数设置'}</Button>
          <span className="video-composer-spacer" />
          <span className="video-composer-cost">预计 {estimatedCredits} Credits · 余额 {balance}</span>
          <Button type="primary" shape="circle" icon={<ArrowUpOutlined />} loading={submitting} disabled={insufficientCredits || !promptValue.trim()} onClick={() => form.submit()} aria-label="生成视频" />
        </div>
      </div>
      </div>
    </div>
  )
}
