'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Button,
  Dropdown,
  Segmented,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  Image as AntdImage,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileImageOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { useTranslations } from 'next-intl'
import {
  generationApi,
  type Generation,
} from '../../lib/api'
import { usePaginatedTaskHistory, type TaskItem } from './usePaginatedTaskHistory'
import { formatErrorMessage } from '../../lib/errorMessage'
import { modelDisplayName } from '../../lib/models'

// ---------------------------------------------------------------------------
// 常量 & 类型
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING']

type HistoryType = 'image' | 'video'
type TaskFilter = 'all' | 'processing' | 'completed' | 'failed'

interface HistoryTask extends TaskItem {
  status: string
  prompt?: string
  mode?: string
  model?: string
  output_url?: string
  input_images?: string[]
  error_message?: unknown
  created_at?: string
  // video-specific
  width?: number
  height?: number
  num_frames?: number
  frame_rate?: number
  progress?: number
}

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

/** 将后端 Generation 归一化为 HistoryTask */
function toHistoryTask(g: Generation, type: HistoryType): HistoryTask {
  const input = (g.input ?? {}) as Record<string, unknown>
  const images = type === 'video' ? (input.images ?? input.image) : input.images
  return {
    id: g.id,
    status: g.status,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    mode: typeof input.mode === 'string' ? input.mode : undefined,
    model: g.model ?? undefined,
    input_images: Array.isArray(images) ? (images as string[]) : undefined,
    output_url: g.output?.url ?? undefined,
    error_message: g.errorMessage,
    created_at: g.completedAt ?? g.createdAt,
    width: typeof input.width === 'number' ? input.width : undefined,
    height: typeof input.height === 'number' ? input.height : undefined,
    num_frames: typeof input.numFrames === 'number' ? input.numFrames : undefined,
    frame_rate: typeof input.frameRate === 'number' ? input.frameRate : undefined,
    progress: typeof g.output?.progress === 'number' ? g.output.progress : undefined,
  }
}

function displayUrl(task: HistoryTask): string {
  return task?.output_url || ''
}

function inputImagesOf(task: HistoryTask): string[] {
  return task?.input_images || []
}

function formatResolution(task: HistoryTask): string {
  if (!task?.width || !task?.height) return '—'
  return `${task.width}×${task.height}`
}

function formatDuration(task: HistoryTask): string {
  if (!task?.num_frames || !task?.frame_rate) return '—'
  return `${(task.num_frames / task.frame_rate).toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export default function GenerationHistory({ type }: { type: HistoryType }) {
  const t = useTranslations(type === 'image' ? 'image' : 'video')
  const tc = useTranslations()
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingRef = useRef(false)
  const mountedRef = useRef(true)

  const { history, historyLoading, resetHistory, setHistory } = usePaginatedTaskHistory(
    useCallback(async () => {
      const list = await generationApi.list(100)
      // 客户端按 type 过滤（后端暂不支持 type 查询参数）
      const targetType = type === 'image' ? 'IMAGE' : 'VIDEO'
      return list
        .filter((g) => g.type === targetType)
        .map((g) => toHistoryTask(g, type))
    }, [type]),
  )

  const historyRef = useRef<HistoryTask[]>(history as HistoryTask[])
  useEffect(() => {
    historyRef.current = history as HistoryTask[]
  }, [history])

  const selectedTask: HistoryTask | null =
    (history.find((t) => t.id === selectedTaskId) as HistoryTask | undefined) || null

  // ---- 任务过滤 ----
  const filteredHistory = useMemo(() => {
    if (taskFilter === 'all') return history
    if (taskFilter === 'processing')
      return history.filter((t) => ACTIVE_STATUSES.includes(t.status))
    if (taskFilter === 'completed')
      return history.filter((t) => t.status === 'SUCCEEDED')
    if (taskFilter === 'failed')
      return history.filter((t) => t.status === 'FAILED' || t.status === 'CANCELED')
    return history
  }, [history, taskFilter])

  // ---- 过滤器选项 ----
  const filterOptions = useMemo(
    () => [
      { value: 'all', label: tc('common.all') },
      { value: 'processing', label: type === 'image' ? tc('status.RUNNING') : t('filterProcessing') },
      { value: 'completed', label: type === 'image' ? tc('status.SUCCEEDED') : t('filterCompleted') },
      { value: 'failed', label: type === 'image' ? tc('status.FAILED') : t('filterFailed') },
    ],
    [tc, t, type],
  )

  const taskErrorMessage = useCallback(
    (task: HistoryTask) =>
      formatErrorMessage(task?.error_message) ||
      (task?.status === 'FAILED' ? t('generateFailed') : ''),
    [t],
  )

  // ---- 轮询逻辑 ----
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
          ACTIVE_STATUSES.includes(t.status) && !String(t.id).startsWith('temp-'),
      ),
    [],
  )

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
          const mapped = toHistoryTask(updated, type)
          setHistory((prev) => prev.map((t) => (t.id === mapped.id ? mapped : t)))
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
  }, [pendingTasks, stopPolling, schedulePoll, setHistory, type])

  const pollTickRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    pollTickRef.current = pollTick
  }, [pollTick])

  const startPollingAll = useCallback(() => {
    stopPolling()
    if (pollingRef.current) return
    schedulePoll()
  }, [stopPolling, schedulePoll])

  // ---- 复制提示词 ----
  const copyPrompt = useCallback(async (prompt?: string) => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      // fallback
    }
  }, [])

  // ---- 下载 ----
  const downloadMedia = useCallback(async (url: string, name?: string) => {
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = name || (type === 'image' ? `enova-${Date.now()}.png` : `enova-video-${Date.now()}.mp4`)
      a.target = '_blank'
      a.click()
    } catch {
      window.open(url, '_blank')
    }
  }, [type])

  // ---- 历史项右键菜单 ----
  const getHistoryMenuItems = useCallback(
    (task: HistoryTask): MenuProps['items'] => [
      {
        key: 'copyPrompt',
        label: type === 'image' ? t('copyPrompt') : t('copyParams'),
        icon: <CopyOutlined />,
        onClick: () => copyPrompt(task.prompt),
      },
      {
        key: 'download',
        label: type === 'image' ? t('download') : t('downloadVideo'),
        icon: <DownloadOutlined />,
        disabled: !displayUrl(task),
        onClick: () => displayUrl(task) && downloadMedia(displayUrl(task)),
      },
      { type: 'divider' },
      {
        key: 'delete',
        label: t('delete') || t('deleteImage') || tc('common.delete'),
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => {
          setHistory((prev) => prev.filter((t) => t.id !== task.id))
          if (selectedTaskId === task.id) setSelectedTaskId(null)
        },
      },
    ],
    [copyPrompt, downloadMedia, setHistory, selectedTaskId, t, tc, type],
  )

  // ---- Initial load ----
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    ;(async () => {
      await resetHistory()
      if (cancelled) return
      startPollingAll()
    })()
    return () => {
      cancelled = true
      mountedRef.current = false
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full overflow-hidden" style={{ backgroundColor: '#F7F8FA' }}>
      {/* ================================================================ */}
      {/* History List                                                      */}
      {/* ================================================================ */}
      <div className="flex-1 flex flex-col bg-white" style={{ borderRight: '1px solid #EAECF0' }}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid #EAECF0' }}>
          <Typography.Title level={3} className="!mb-1" style={{ fontSize: 24, fontWeight: 600, color: '#101828' }}>
            {t('historyTitle')}
          </Typography.Title>
          <Typography.Text style={{ fontSize: 13, color: '#667085' }}>
            {tc('navigation.history')}
          </Typography.Text>

          {/* 状态过滤 */}
          <div className="mt-4">
            <Segmented
              block
              size="small"
              value={taskFilter}
              onChange={(val) => setTaskFilter(val as TaskFilter)}
              options={filterOptions}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {filteredHistory.map((rawTask) => {
            const task = rawTask as HistoryTask
            const isSelected = selectedTaskId === task.id
            return (
              <Dropdown
                key={String(task.id)}
                trigger={['contextMenu']}
                menu={{ items: getHistoryMenuItems(task) }}
              >
                <div
                  onClick={() => setSelectedTaskId(task.id)}
                  className="group relative p-3 rounded-xl cursor-pointer transition-all duration-200 border"
                  style={{
                    borderColor: isSelected ? '#0F9F91' : 'transparent',
                    backgroundColor: isSelected ? '#F0FDFA' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = '#F7F8FA'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <div className="flex gap-3">
                    {/* Thumbnail */}
                    <div
                      className="w-16 h-16 rounded-lg flex-shrink-0 overflow-hidden flex items-center justify-center"
                      style={{ backgroundColor: '#F7F8FA', border: '1px solid #EAECF0' }}
                    >
                      {displayUrl(task) ? (
                        type === 'image' ? (
                          <AntdImage
                            src={displayUrl(task)}
                            alt={task.prompt || ''}
                            width="100%"
                            height="100%"
                            className="object-cover"
                            preview={false}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <video
                            src={displayUrl(task)}
                            className="w-full h-full object-cover"
                            muted
                          />
                        )
                      ) : inputImagesOf(task).length > 0 ? (
                        <AntdImage
                          src={inputImagesOf(task)[0]}
                          alt={task.prompt || ''}
                          width="100%"
                          height="100%"
                          className="object-cover"
                          preview={false}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : ACTIVE_STATUSES.includes(task.status) ? (
                        <div
                          className="w-5 h-5 border-2 rounded-full animate-spin"
                          style={{ borderColor: '#0F9F91', borderTopColor: 'transparent' }}
                        />
                      ) : type === 'image' ? (
                        <FileImageOutlined style={{ color: '#D0D5DD', fontSize: 18 }} />
                      ) : (
                        <VideoCameraOutlined style={{ color: '#D0D5DD', fontSize: 18 }} />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm truncate font-medium leading-tight"
                        style={{ color: '#101828' }}
                      >
                        {task.prompt || '—'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-xs" style={{ color: '#98A2B3' }}>
                          {modelDisplayName(task.model)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs" style={{ color: '#98A2B3' }}>
                          {relativeTime(task.created_at)}
                        </span>
                        <Tag
                          color={statusBadgeColor(task.status)}
                          className="!m-0 !text-[10px] !px-1.5 !rounded-full"
                        >
                          {statusLabel(tc, task.status)}
                        </Tag>
                      </div>

                      {/* Progress bar for active tasks (video) */}
                      {type === 'video' && ACTIVE_STATUSES.includes(task.status) && (
                        <div className="mt-2">
                          <div
                            className="w-full h-1.5 rounded-full overflow-hidden"
                            style={{ backgroundColor: '#F7F8FA' }}
                          >
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width:
                                  task.progress != null
                                    ? `${Math.min(100, Math.max(0, task.progress))}%`
                                    : '100%',
                                backgroundColor: '#0F9F91',
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Hover More Menu */}
                    <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Dropdown trigger={['click']} menu={{ items: getHistoryMenuItems(task) }}>
                        <Button
                          type="text"
                          size="small"
                          className="!w-6 !h-6 !min-w-6 flex items-center justify-center"
                          style={{ color: '#98A2B3' }}
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

          {!history.length && historyLoading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Skeleton active paragraph={{ rows: 2 }} />
            </div>
          )}

          {!history.length && !historyLoading && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                style={{ backgroundColor: '#F7F8FA', border: '1px solid #EAECF0' }}
              >
                {type === 'image' ? (
                  <FileImageOutlined style={{ fontSize: 20, color: '#D0D5DD' }} />
                ) : (
                  <VideoCameraOutlined style={{ fontSize: 20, color: '#D0D5DD' }} />
                )}
              </div>
              <p className="text-sm" style={{ color: '#667085' }}>
                {t('historyPageEmpty')}
              </p>
              <p className="text-xs mt-1" style={{ color: '#98A2B3' }}>
                {t('historyPageEmptyHint')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* Detail Panel (selected task)                                      */}
      {/* ================================================================ */}
      <div className="w-[400px] flex-shrink-0 overflow-y-auto bg-white" style={{ borderLeft: '1px solid #EAECF0' }}>
        {selectedTask ? (
          <div className="p-6">
            {/* Preview */}
            <div className="flex items-center justify-center mb-4">
              {displayUrl(selectedTask) ? (
                type === 'image' ? (
                  <AntdImage
                    src={displayUrl(selectedTask)}
                    alt={selectedTask.prompt || ''}
                    className="rounded-xl border border-gray-100 object-contain max-h-[50vh] bg-gray-50"
                    preview={{ mask: false }}
                    style={{ maxWidth: '100%' }}
                  />
                ) : (
                  <video
                    src={displayUrl(selectedTask)}
                    controls
                    autoPlay
                    loop
                    className="rounded-xl"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '50vh',
                      border: '1px solid #EAECF0',
                    }}
                  />
                )
              ) : ACTIVE_STATUSES.includes(selectedTask.status) ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div
                    className="w-10 h-10 rounded-full border-4 animate-spin mb-4"
                    style={{ borderColor: '#0F9F91', borderTopColor: 'transparent' }}
                  />
                  <Typography.Text style={{ color: '#98A2B3' }}>
                    {t('generatingHint')}
                  </Typography.Text>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <ExclamationCircleOutlined style={{ fontSize: 32, color: '#F59E0B' }} />
                  <Typography.Text className="mt-3 block max-w-sm text-center" style={{ color: '#98A2B3' }}>
                    {taskErrorMessage(selectedTask) || t('generateFailed')}
                  </Typography.Text>
                </div>
              )}
            </div>

            {/* Action Bar */}
            {displayUrl(selectedTask) && (
              <div className="flex items-center justify-center gap-1 mb-4">
                <Tooltip title={type === 'image' ? t('download') : t('downloadVideo')}>
                  <Button
                    type="text"
                    size="small"
                    className="!w-9 !h-9 !min-w-9 flex items-center justify-center"
                    style={{ color: '#667085' }}
                    onClick={() => displayUrl(selectedTask) && downloadMedia(displayUrl(selectedTask))}
                  >
                    <DownloadOutlined />
                  </Button>
                </Tooltip>
                <Tooltip title={type === 'image' ? t('copyPrompt') : t('copyParams')}>
                  <Button
                    type="text"
                    size="small"
                    className="!w-9 !h-9 !min-w-9 flex items-center justify-center"
                    style={{ color: '#667085' }}
                    onClick={() => copyPrompt(selectedTask.prompt)}
                  >
                    <CopyOutlined />
                  </Button>
                </Tooltip>
              </div>
            )}

            {/* Params Section */}
            <div className="pt-3" style={{ borderTop: '1px solid #EAECF0' }}>
              <Typography.Text strong style={{ fontSize: 12, color: '#667085' }}>
                {t('params')}
              </Typography.Text>
              <div className="space-y-2 mt-2">
                <div>
                  <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                    {t('prompt')}
                  </Typography.Text>
                  <p className="mt-0.5 leading-relaxed" style={{ color: '#101828' }}>
                    {selectedTask.prompt || '—'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 pt-1">
                  <div>
                    <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                      {type === 'image' ? t('mode') : t('modelLabel')}:{' '}
                    </Typography.Text>
                    <Typography.Text style={{ fontSize: 12, color: '#101828' }}>
                      {type === 'image' ? selectedTask.mode || '—' : modelDisplayName(selectedTask.model)}
                    </Typography.Text>
                  </div>
                  {type === 'video' && (
                    <>
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
                    </>
                  )}
                  <div>
                    <Typography.Text style={{ fontSize: 12, color: '#98A2B3' }}>
                      {tc('status.status')}:{' '}
                    </Typography.Text>
                    <Tag color={statusBadgeColor(selectedTask.status)} className="!m-0 !text-[10px]">
                      {statusLabel(tc, selectedTask.status)}
                    </Tag>
                  </div>
                </div>
              </div>
            </div>

            {/* Reference Images (video) */}
            {type === 'video' && inputImagesOf(selectedTask).length > 0 && (
              <div className="mt-4">
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

            {/* Go to generate */}
            <div className="mt-6">
              <Link href={type === 'image' ? '/app/images' : '/app/videos'}>
                <Button
                  type="primary"
                  block
                  style={{ height: 40, borderRadius: 10 }}
                  icon={<ReloadOutlined />}
                >
                  {type === 'image' ? t('startGenerate') : t('generateVideo', { credits: 10 })}
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-20 px-8 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ backgroundColor: '#F7F8FA', border: '1px solid #EAECF0' }}
            >
              {type === 'image' ? (
                <FileImageOutlined style={{ fontSize: 24, color: '#D0D5DD' }} />
              ) : (
                <PlayCircleOutlined style={{ fontSize: 24, color: '#D0D5DD' }} />
              )}
            </div>
            <Typography.Title level={5} className="!mb-1" style={{ color: '#101828' }}>
              {tc('common.details')}
            </Typography.Title>
            <Typography.Text style={{ fontSize: 13, color: '#98A2B3' }}>
              {t('historyPageEmptyHint')}
            </Typography.Text>
          </div>
        )}
      </div>
    </div>
  )
}
