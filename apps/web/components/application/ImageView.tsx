'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Form, Input } from 'antd'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { generationApi, uploadApi, type CreateGenerationPayload, type Generation } from '../../lib/api'
import { useSession } from '../../lib/auth'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODES, legacySizeToNative } from '../../lib/models'
import CreationTemplates from './image-creator/CreationTemplates'
import GenerationCanvas from './image-creator/GenerationCanvas'
import PromptComposer from './image-creator/PromptComposer'
import Sidebar from './image-creator/Sidebar'
import type { ImageCardActions, ImageFormValues, ImageTask, InputImage, PreviewState, GenerationMode } from './image-creator/types.js'
import { useApiKeyGuard } from './useApiKeyGuard'
import { useDialog } from './DialogProvider'
import { usePaginatedTaskHistory } from './usePaginatedTaskHistory'

const MAX_COMPOSE_IMAGES = 6
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024
const MAX_PROMPT_LENGTH = 2000
const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING']

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
  return { id: g.id, status: g.status, prompt: typeof input.prompt === 'string' ? input.prompt : undefined, mode: typeof input.mode === 'string' ? input.mode : undefined, size, ratio, model: g.model ?? undefined, input_images: Array.isArray(images) ? images as string[] : undefined, output_url: g.output?.url ?? undefined, error_message: g.errorMessage, created_at: g.completedAt ?? g.createdAt }
}
function displayUrl(task: ImageTask) { return task.output_url || '' }
function inputImagesOf(task: ImageTask) { return task.input_images || [] }
function getPreviewState(task: ImageTask | null, generating: boolean): PreviewState {
  if (!task) return 'empty'
  if (ACTIVE_STATUSES.includes(task.status) || generating) return 'generating'
  if (task.status === 'FAILED' || task.status === 'CANCELED') return 'error'
  return displayUrl(task) ? 'success' : 'empty'
}

export default function ImageView() {
  const t = useTranslations('image')
  const { alert } = useDialog()
  const { hasActiveKey, keyStatusLoading, refreshKeyStatus, requireApiKey } = useApiKeyGuard()
  const { balance, user } = useSession()
  const pathname = usePathname()
  const [form] = Form.useForm<ImageFormValues>()
  const [inputImages, setInputImages] = useState<InputImage[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateStep, setGenerateStep] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const [error, setError] = useState('')
  const [currentMode, setCurrentMode] = useState<GenerationMode>('text2img')
  const [promptValue, setPromptValue] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const formCardRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<ImageTask[]>([])
  const selectedTaskRef = useRef<string | number | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingRef = useRef(false)
  const mountedRef = useRef(true)
  const pollTickRef = useRef<() => Promise<void>>(async () => {})
  const inputImagesRef = useRef<InputImage[]>([])
  const { history, resetHistory, setHistory } = usePaginatedTaskHistory(useCallback(async () => (await generationApi.list(50)).map(toImageTask), []))
  useEffect(() => { historyRef.current = history as ImageTask[] }, [history])
  useEffect(() => { selectedTaskRef.current = selectedTaskId }, [selectedTaskId])
  useEffect(() => { inputImagesRef.current = inputImages }, [inputImages])
  const selectedTask = (history.find((task) => task.id === selectedTaskId) as ImageTask | undefined) || null
  const previewState = useMemo(() => getPreviewState(selectedTask, generating), [selectedTask, generating])
  const revokePreview = useCallback((item: InputImage) => { if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview) }, [])
  const handleModeChange = useCallback((mode: string) => { setCurrentMode(mode as GenerationMode); if (mode === 'img2img' && inputImages.length > 1) { inputImages.slice(1).forEach(revokePreview); setInputImages([inputImages[0]]) } }, [inputImages, revokePreview])
  const validateFile = useCallback((file: File) => { if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return t('uploadFormats'); if (file.size > MAX_UPLOAD_SIZE) return `${file.name} > 10MB`; return null }, [t])
  const handleSingleUpload = useCallback((file: File) => { const err = validateFile(file); if (err) { setError(err); return false }; setError(''); if (inputImages[0]) revokePreview(inputImages[0]); setInputImages([{ file, preview: URL.createObjectURL(file) }]); return false }, [inputImages, revokePreview, validateFile])
  const handleMultiUpload = useCallback((file: File) => { const err = validateFile(file); if (err) { setError(err); return false }; if (inputImages.length >= MAX_COMPOSE_IMAGES) { setError(`${MAX_COMPOSE_IMAGES}`); return false }; setError(''); setInputImages((previous) => [...previous, { file, preview: URL.createObjectURL(file) }]); return false }, [inputImages.length, validateFile])
  const removeInputImage = useCallback((index: number) => { setInputImages((previous) => { const next = [...previous]; if (next[index]) revokePreview(next[index]); next.splice(index, 1); return next }) }, [revokePreview])
  const replaceInputImage = useCallback((index: number) => { const input = document.createElement('input'); input.type = 'file'; input.accept = ACCEPTED_IMAGE_TYPES.join(','); input.onchange = (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; const err = validateFile(file); if (err) { setError(err); return }; setInputImages((previous) => { const next = [...previous]; if (next[index]) revokePreview(next[index]); next[index] = { file, preview: URL.createObjectURL(file) }; return next }) }; input.click() }, [revokePreview, validateFile])
  const uploadLocalFiles = useCallback(async (items: InputImage[]) => { const urls: string[] = []; for (const item of items) { if (item.file) urls.push((await uploadApi.upload(item.file)).url); else if (item.preview && !item.preview.startsWith('blob:')) urls.push(item.preview) }; return urls }, [])

  const generate = useCallback(async (values: ImageFormValues) => {
    if (!values.prompt.trim()) { setError(t('promptRequired')); return }
    if (values.mode === 'img2img' && !inputImages.length) { setError(t('referenceRequired')); return }
    if (values.mode === 'multi_img' && !inputImages.length) { setError(t('inputImagesRequired')); return }
    if (!(await requireApiKey())) return
    setGenerating(true); setGenerateStep(values.mode === 'text2img' ? 'generating' : 'uploading'); setError('')
    const tempId = `temp-${Date.now()}`
    const optimisticTask: ImageTask = { id: tempId, status: 'RUNNING', prompt: values.prompt, mode: values.mode, size: values.size, ratio: values.ratio, model: values.model, _optimistic: true }
    setHistory((previous) => [optimisticTask, ...previous]); setSelectedTaskId(tempId)
    try {
      let images: string[] | undefined
      if (values.mode !== 'text2img' && inputImages.length) images = await uploadLocalFiles(inputImages)
      const payload: CreateGenerationPayload = { type: 'IMAGE', provider: 'agnes', model: values.model, input: { prompt: values.prompt, mode: values.mode, size: values.size, ratio: values.ratio, ...(images ? { images } : {}) } }
      setGenerateStep('generating'); const task = toImageTask(await generationApi.create(payload))
      setHistory((previous) => [task, ...previous.filter((item) => item.id !== tempId)]); setSelectedTaskId(task.id)
    } catch (err) {
      setHistory((previous) => previous.filter((item) => item.id !== tempId)); setSelectedTaskId(null); setError((err as Error).message)
      await alert({ title: t('generateFailed'), message: (err as Error).message, confirmVariant: 'danger' })
    } finally { setGenerating(false); setGenerateStep('') }
  }, [alert, inputImages, requireApiKey, setHistory, t, uploadLocalFiles])

  const fillFormFromTask = useCallback((task: ImageTask) => { if (!task || task._optimistic) return; form.setFieldsValue({ model: task.model || DEFAULT_IMAGE_MODEL, mode: task.mode || 'text2img', prompt: task.prompt || '', size: task.size || '1K', ratio: task.ratio || '1:1' }); setPromptValue(task.prompt || ''); setCurrentMode((task.mode as GenerationMode) || 'text2img'); inputImages.forEach(revokePreview); setInputImages(inputImagesOf(task).map((url) => ({ preview: url }))); setError(''); formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [form, inputImages, revokePreview])
  const copyPrompt = useCallback(async (prompt?: string) => { if (!prompt) return; try { await navigator.clipboard.writeText(prompt) } catch { /* optional */ } }, [])
  const downloadImage = useCallback(async (url: string, name?: string) => { try { const response = await fetch(url); const objectUrl = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = name || `enova-${Date.now()}.png`; anchor.click(); URL.revokeObjectURL(objectUrl) } catch { window.open(url, '_blank') } }, [])
  const regenerateFromTask = useCallback((task: ImageTask) => { fillFormFromTask(task); form.submit() }, [fillFormFromTask, form])
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = null
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])
  const pendingTasks = useCallback(() => historyRef.current.filter((task) => ACTIVE_STATUSES.includes(task.status) && !String(task.id).startsWith('temp-')), [])
  const schedulePoll = useCallback(() => {
    if (!mountedRef.current) return
    stopPolling()
    pollTimerRef.current = setTimeout(() => { void pollTickRef.current() }, 8000)
  }, [stopPolling])
  const pollTick = useCallback(async () => {
    if (pollingRef.current || !mountedRef.current) return
    pollingRef.current = true
    try {
      const pending = pendingTasks()
      if (!pending.length) { stopPolling(); return }
      for (const task of pending) {
        try {
          const updated = toImageTask(await generationApi.get(String(task.id)))
          setHistory((previous) => previous.map((item) => item.id === updated.id ? updated : item))
          if (!ACTIVE_STATUSES.includes(updated.status) && (updated.status === 'FAILED' || updated.status === 'CANCELED') && selectedTaskRef.current === updated.id) {
            const message = updated.error_message ? String(updated.error_message) : t('generateFailed')
            setError(message)
            await alert({ title: t('generateFailed'), message, confirmVariant: 'danger' })
          }
        } catch {
          // Ignore transient status requests and retry on the next tick.
        }
      }
    } finally { pollingRef.current = false }
    if (mountedRef.current && pendingTasks().length) schedulePoll()
    else stopPolling()
  }, [alert, pendingTasks, schedulePoll, setHistory, stopPolling, t])
  useEffect(() => { pollTickRef.current = pollTick }, [pollTick])
  useEffect(() => { let cancelled = false; (async () => { await refreshKeyStatus(); if (!cancelled) await resetHistory() })(); return () => { cancelled = true } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => () => inputImagesRef.current.forEach(revokePreview), [revokePreview])
  useEffect(() => {
    if (!history.length) { stopPolling(); return }
    if (selectedTaskId === null) {
      const latest = (history as ImageTask[]).find((task) => !task._optimistic && (displayUrl(task) || ACTIVE_STATUSES.includes(task.status) || task.status === 'FAILED' || task.status === 'CANCELED'))
      if (latest) setSelectedTaskId(latest.id)
    }
    if (pendingTasks().length) schedulePoll()
    else stopPolling()
  }, [history, pendingTasks, schedulePoll, selectedTaskId, stopPolling])
  const currentSize = Form.useWatch('size', form) || '1K'
  const currentRatio = Form.useWatch('ratio', form) || '1:1'
  const modeOptions = useMemo(() => IMAGE_MODES.map((mode) => ({ value: mode.id, label: mode.name })), [])
  const activeItem = pathname?.includes('/videos') ? 'video' : pathname?.includes('/settings') ? 'settings' : 'generate'
  const handleDeleteTask = useCallback((task: ImageTask) => {
    // No user-facing image deletion endpoint exists; preserve the prior local-history semantics.
    const next = historyRef.current.filter((item) => item.id !== task.id)
    setHistory(next)
    if (selectedTaskRef.current === task.id) setSelectedTaskId((next.find((item) => displayUrl(item))?.id ?? null))
  }, [setHistory])
  const imageActions: ImageCardActions = { onDownload: (task) => { const url = displayUrl(task); if (url) return downloadImage(url) }, onRegenerate: regenerateFromTask, onEdit: fillFormFromTask, onCopyPrompt: copyPrompt, onDelete: handleDeleteTask }
  const setFormValue = useCallback(<K extends keyof ImageFormValues>(field: K, value: ImageFormValues[K]) => form.setFieldValue(field, value), [form])

  return <div className="flex h-full min-h-0 overflow-hidden bg-[#fafafa]">
    <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} activeItem={activeItem} credits={balance} creditsHref="/app/wallet" userName={user?.email?.split('@')[0] || '创作者'} userEmail={user?.email} userHref="/app/settings" />
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden"><Form form={form} onFinish={generate} initialValues={{ model: DEFAULT_IMAGE_MODEL, mode: 'text2img', prompt: '', size: '1K', ratio: '1:1' }} className="flex min-h-0 flex-1 flex-col">
      <div ref={formCardRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-5 sm:px-8 sm:pt-8">
        <header className="mb-6 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t('title')}</h1><p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p></div>{!keyStatusLoading && !hasActiveKey && <Alert type="warning" showIcon message={t('insufficientBalance')} className="max-w-sm" />}</header>
        {previewState === 'empty' && <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center py-8"><div className="mb-8 text-center"><h2 className="text-3xl font-semibold text-gray-900">{t('emptyTitle')}</h2><p className="mt-2 text-sm text-gray-500">{t('emptyHint')}</p></div><CreationTemplates onSelect={(prompt) => { setFormValue('prompt', prompt); setPromptValue(prompt) }} /></section>}
        {previewState !== 'empty' && <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col"><GenerationCanvas state={previewState} task={selectedTask} tasks={history as ImageTask[]} status={generateStep === 'uploading' ? t('generatingWithUpload') : t('generatingNow')} errorMessage={selectedTask?.error_message ? String(selectedTask.error_message) : error} {...imageActions} /></section>}
        <Form.Item name="prompt" hidden><Input /></Form.Item><Form.Item name="mode" hidden><Input /></Form.Item><Form.Item name="model" hidden><Input /></Form.Item><Form.Item name="ratio" hidden><Input /></Form.Item><Form.Item name="size" hidden><Input /></Form.Item>
      </div>
      <div className="sticky bottom-0 z-10 px-4 pb-4 sm:px-8"><PromptComposer prompt={promptValue} onPromptChange={(value) => { setPromptValue(value); setFormValue('prompt', value) }} mode={currentMode} model={form.getFieldValue('model') || DEFAULT_IMAGE_MODEL} ratio={currentRatio} size={currentSize} onModeChange={(value) => { handleModeChange(value); setFormValue('mode', value) }} onModelChange={(value) => setFormValue('model', value)} onRatioChange={(value) => setFormValue('ratio', value)} onSizeChange={(value) => setFormValue('size', value)} inputImages={inputImages} onUpload={(file) => currentMode === 'multi_img' ? handleMultiUpload(file) : handleSingleUpload(file)} onReplaceImage={replaceInputImage} onRemoveImage={removeInputImage} onSubmit={() => form.submit()} generating={generating} generateStep={generateStep} error={error} balance={balance} estimatedCost={2} modeOptions={modeOptions} maxImages={MAX_COMPOSE_IMAGES} maxLength={MAX_PROMPT_LENGTH} /></div>
    </Form></main>
  </div>
}
