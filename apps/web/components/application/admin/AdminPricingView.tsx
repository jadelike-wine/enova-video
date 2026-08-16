'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Table,
  Tabs,
  Tag,
  Divider,
} from 'antd'
import type { TableProps } from 'antd'
import { ReloadOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import {
  adminPricingApi,
  type AdminModelPricingView,
  type PublishPricingVersionResult,
} from '../../../lib/adminApi'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { PageHeader, fmtDate } from './AdminUi'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResolutionEntry {
  key: string
  multiplier: number
}

interface QualityEntry {
  key: string
  multiplier: number
}

interface FpsEntry {
  key: string
  multiplier: number
}

interface SizeEntry {
  key: string
  multiplier: number
}

interface DynamicRulesForm {
  baseCredits: number
  pricePerSecond?: number
  resolutions: ResolutionEntry[]
  qualities: QualityEntry[]
  fpsList: FpsEntry[]
  sizes: SizeEntry[]
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function PricingStatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; text: string }> = {
    UNCONFIGURED: { color: 'default', text: '未配置' },
    PUBLISHED: { color: 'success', text: '已发布' },
    DRAFT: { color: 'warning', text: '草稿' },
    ARCHIVED: { color: 'default', text: '已归档' },
  }
  const cfg = map[status] ?? { color: 'default', text: status || '—' }
  return <Tag color={cfg.color}>{cfg.text}</Tag>
}

// ---------------------------------------------------------------------------
// Dynamic rules <-> form conversion
// ---------------------------------------------------------------------------

function dynamicRulesToForm(
  rules: Record<string, unknown> | null,
): DynamicRulesForm {
  if (!rules) {
    return { baseCredits: 0, resolutions: [], qualities: [], fpsList: [], sizes: [] }
  }
  const r = rules as Record<string, unknown>
  const baseCredits = Number(r.baseCredits ?? r.base_credits ?? 0)
  const duration = r.duration as { pricePerSecond?: number; price_per_second?: number } | undefined
  const pricePerSecond = duration ? Number(duration.pricePerSecond ?? duration.price_per_second) : undefined
  const sizeMap = (r.size ?? {}) as Record<string, number>
  const resolutionMap = (r.resolution ?? {}) as Record<string, number>
  const qualityMap = (r.quality ?? {}) as Record<string, number>
  const fpsMap = (r.fps ?? {}) as Record<string, number>

  return {
    baseCredits,
    pricePerSecond: pricePerSecond && pricePerSecond > 0 ? pricePerSecond : undefined,
    sizes: Object.entries(sizeMap).map(([key, multiplier]) => ({ key, multiplier: Number(multiplier) })),
    resolutions: Object.entries(resolutionMap).map(([key, multiplier]) => ({ key, multiplier: Number(multiplier) })),
    qualities: Object.entries(qualityMap).map(([key, multiplier]) => ({ key, multiplier: Number(multiplier) })),
    fpsList: Object.entries(fpsMap).map(([key, multiplier]) => ({ key, multiplier: Number(multiplier) })),
  }
}

function formToDynamicRules(form: DynamicRulesForm, generationType: string): Record<string, unknown> {
  const rules: Record<string, unknown> = {
    baseCredits: form.baseCredits,
  }
  if (generationType === 'VIDEO' && form.pricePerSecond && form.pricePerSecond > 0) {
    rules.duration = { pricePerSecond: form.pricePerSecond }
  }
  if (form.sizes.length > 0) {
    const s: Record<string, number> = {}
    for (const e of form.sizes) {
      if (e.key.trim()) s[e.key.trim()] = e.multiplier
    }
    rules.size = s
  }
  if (form.resolutions.length > 0) {
    const res: Record<string, number> = {}
    for (const e of form.resolutions) {
      if (e.key.trim()) res[e.key.trim()] = e.multiplier
    }
    rules.resolution = res
  }
  if (form.qualities.length > 0) {
    const q: Record<string, number> = {}
    for (const e of form.qualities) {
      if (e.key.trim()) q[e.key.trim()] = e.multiplier
    }
    rules.quality = q
  }
  if (generationType === 'VIDEO' && form.fpsList.length > 0) {
    const f: Record<string, number> = {}
    for (const e of form.fpsList) {
      if (e.key.trim()) f[e.key.trim()] = e.multiplier
    }
    rules.fps = f
  }
  return rules
}

// ---------------------------------------------------------------------------
// Dynamic pricing form modal
// ---------------------------------------------------------------------------

function DynamicPricingModal({
  model,
  open,
  onClose,
  onSuccess,
}: {
  model: AdminModelPricingView | null
  open: boolean
  onClose: () => void
  onSuccess: (result: PublishPricingVersionResult) => void
}) {
  const { message } = App.useApp()
  const [submitting, setSubmitting] = useState(false)
  const [baseCredits, setBaseCredits] = useState(0)
  const [pricePerSecond, setPricePerSecond] = useState<number | undefined>(undefined)
  const [sizes, setSizes] = useState<SizeEntry[]>([])
  const [resolutions, setResolutions] = useState<ResolutionEntry[]>([])
  const [qualities, setQualities] = useState<QualityEntry[]>([])
  const [fpsList, setFpsList] = useState<FpsEntry[]>([])
  const isVideo = model?.generationType === 'VIDEO'
  const isDynamic = model?.isDynamic

  useEffect(() => {
    if (open && model) {
      const form = dynamicRulesToForm(model.dynamicRules)
      setBaseCredits(form.baseCredits)
      setPricePerSecond(form.pricePerSecond)
      setSizes(form.sizes.length > 0 ? form.sizes : defaultSizes(model.generationType))
      setResolutions(form.resolutions.length > 0 ? form.resolutions : defaultResolutions(model.generationType, model.model))
      setQualities(form.qualities.length > 0 ? form.qualities : defaultQualities(model.generationType, model.model))
      setFpsList(form.fpsList.length > 0 ? form.fpsList : defaultFps(model.model))
    }
  }, [open, model])

  const handleSubmit = async () => {
    if (!model) return
    if (baseCredits < 0 || !Number.isFinite(baseCredits)) {
      message.warning('请输入有效的基础 Credits')
      return
    }
    if (isVideo && pricePerSecond != null && pricePerSecond < 0) {
      message.warning('每秒价格不能为负')
      return
    }
    const form: DynamicRulesForm = {
      baseCredits,
      pricePerSecond: isVideo ? pricePerSecond : undefined,
      sizes,
      resolutions,
      qualities,
      fpsList: isVideo ? fpsList : [],
    }
    const dynamicRules = formToDynamicRules(form, model.generationType)

    setSubmitting(true)
    try {
      const result = await adminPricingApi.publishVersion({
          generationType: model.generationType,
          provider: model.provider,
          model: model.model,
          credits: 0,
          dynamicRules,
        },
      )
      onSuccess(result)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={`${isVideo ? '视频' : '图片'}动态定价规则`}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="发布"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
      width={680}
    >
      {model && (
        <div className="space-y-4">
          {/* Model info */}
          <div className="p-3 bg-gray-50 rounded-lg space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">模型</span>
              <span className="font-medium text-gray-900">{model.displayName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Provider</span>
              <span className="font-medium text-gray-900">{model.provider}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">当前模式</span>
              <span className="font-medium text-gray-900">
                {isDynamic ? `动态定价 (v${model.currentVersion})` : model.currentVersion ? `固定 ${model.currentCredits} Credits (v${model.currentVersion})` : '未配置'}
              </span>
            </div>
          </div>

          {/* Base credits */}
          <div>
            <div className="mb-1 text-sm font-medium text-gray-700">基础价格（Credits）</div>
            <InputNumber
              className="w-full"
              value={baseCredits}
              onChange={(v) => setBaseCredits(Number(v) || 0)}
              min={0}
              precision={0}
              placeholder="例如：10"
            />
            <div className="mt-1 text-xs text-gray-400">
              {isVideo
                ? model?.model === 'agnes-video-v2.0'
                  ? 'Agnes Video 公式：base + (时长 × 每秒价格) × 分辨率倍率。时长 = num_frames / frame_rate（精确浮点）。不使用 quality/fps 倍率。'
                  : '视频公式：base + (时长 × 每秒价格) × 分辨率倍率 × 质量倍率 × FPS倍率'
                : '图片公式：base × 尺寸倍率(或分辨率倍率) × 质量倍率。Agnes Image 使用 size 档位定价，不使用 quality。'}
            </div>
          </div>

          {/* Duration (video only) */}
          {isVideo && (
            <div>
              <div className="mb-1 text-sm font-medium text-gray-700">时长价格（每秒 Credits）</div>
              <InputNumber
                className="w-full"
                value={pricePerSecond}
                onChange={(v) => setPricePerSecond(v ?? undefined)}
                min={0}
                step={0.1}
                placeholder="例如：15"
              />
            </div>
          )}

          {/* Size (Agnes image native) */}
          {!isVideo && (
            <div>
              <div className="mb-1 text-sm font-medium text-gray-700">尺寸档位倍率（Agnes 原生）</div>
              <div className="text-xs text-gray-400 mb-2">
                Agnes Image 2.1 Flash 使用 1K/2K/3K/4K 档位式 size 定价。同一档位下不同 ratio 价格相同。
              </div>
              <div className="space-y-2">
                {sizes.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={entry.key}
                      onChange={(e) => {
                        const next = [...sizes]
                        next[idx] = { ...entry, key: e.target.value }
                        setSizes(next)
                      }}
                      placeholder="例如：1K / 2K / 3K / 4K"
                    />
                    <span className="text-gray-400 text-sm">x</span>
                    <InputNumber
                      className="w-24"
                      value={entry.multiplier}
                      onChange={(v) => {
                        const next = [...sizes]
                        next[idx] = { ...entry, multiplier: Number(v) || 1 }
                        setSizes(next)
                      }}
                      min={0}
                      step={0.1}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setSizes(sizes.filter((_, i) => i !== idx))}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setSizes([...sizes, { key: '', multiplier: 1 }])}
                >
                  添加尺寸档位
                </Button>
              </div>
            </div>
          )}

          {/* Resolution */}
          <div>
            <div className="mb-1 text-sm font-medium text-gray-700">分辨率倍率（可选，向后兼容）</div>
            <div className="space-y-2">
              {resolutions.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    value={entry.key}
                    onChange={(e) => {
                      const next = [...resolutions]
                      next[idx] = { ...entry, key: e.target.value }
                      setResolutions(next)
                    }}
                    placeholder="例如：1080p 或 1024x1024"
                  />
                  <span className="text-gray-400 text-sm">x</span>
                  <InputNumber
                    className="w-24"
                    value={entry.multiplier}
                    onChange={(v) => {
                      const next = [...resolutions]
                      next[idx] = { ...entry, multiplier: Number(v) || 1 }
                      setResolutions(next)
                    }}
                    min={0}
                    step={0.1}
                  />
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setResolutions(resolutions.filter((_, i) => i !== idx))}
                  />
                </div>
              ))}
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setResolutions([...resolutions, { key: '', multiplier: 1 }])}
              >
                添加分辨率
              </Button>
            </div>
          </div>

          {/* Quality */}
          <div>
            <div className="mb-1 text-sm font-medium text-gray-700">质量倍率（可选）</div>
            <div className="space-y-2">
              {qualities.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    value={entry.key}
                    onChange={(e) => {
                      const next = [...qualities]
                      next[idx] = { ...entry, key: e.target.value }
                      setQualities(next)
                    }}
                    placeholder="例如：standard / hd / high"
                  />
                  <span className="text-gray-400 text-sm">x</span>
                  <InputNumber
                    className="w-24"
                    value={entry.multiplier}
                    onChange={(v) => {
                      const next = [...qualities]
                      next[idx] = { ...entry, multiplier: Number(v) || 1 }
                      setQualities(next)
                    }}
                    min={0}
                    step={0.1}
                  />
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setQualities(qualities.filter((_, i) => i !== idx))}
                  />
                </div>
              ))}
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setQualities([...qualities, { key: '', multiplier: 1 }])}
              >
                添加质量等级
              </Button>
            </div>
          </div>

          {/* FPS (video only) */}
          {isVideo && (
            <div>
              <div className="mb-1 text-sm font-medium text-gray-700">FPS 倍率（可选）</div>
              <div className="space-y-2">
                {fpsList.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={entry.key}
                      onChange={(e) => {
                        const next = [...fpsList]
                        next[idx] = { ...entry, key: e.target.value }
                        setFpsList(next)
                      }}
                      placeholder="例如：24 / 30 / 60"
                    />
                    <span className="text-gray-400 text-sm">x</span>
                    <InputNumber
                      className="w-24"
                      value={entry.multiplier}
                      onChange={(v) => {
                        const next = [...fpsList]
                        next[idx] = { ...entry, multiplier: Number(v) || 1 }
                        setFpsList(next)
                      }}
                      min={0}
                      step={0.1}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setFpsList(fpsList.filter((_, i) => i !== idx))}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setFpsList([...fpsList, { key: '', multiplier: 1 }])}
                >
                  添加 FPS
                </Button>
              </div>
            </div>
          )}

          <Divider className="!my-2" />

          <div className="mb-2 p-3 bg-amber-50 rounded text-xs text-amber-700">
            发布后，新生成任务将使用动态规则计算 Credits。历史报价和历史任务不受影响。
          </div>
        </div>
      )}
    </Modal>
  )
}

function defaultSizes(generationType: string): SizeEntry[] {
  if (generationType === 'IMAGE') {
    return [
      { key: '1K', multiplier: 1 },
      { key: '2K', multiplier: 2 },
      { key: '3K', multiplier: 3 },
      { key: '4K', multiplier: 4 },
    ]
  }
  return []
}

function defaultResolutions(generationType: string, model?: string): ResolutionEntry[] {
  if (generationType === 'IMAGE') {
    return []
  }
  // Agnes Video V2.0 只支持 480p/720p/1080p，不支持 4k
  if (model === 'agnes-video-v2.0') {
    return [
      { key: '480p', multiplier: 1 },
      { key: '720p', multiplier: 1 },
      { key: '1080p', multiplier: 1 },
    ]
  }
  // 其他视频模型保留历史默认值
  return [
    { key: '720p', multiplier: 1 },
    { key: '1080p', multiplier: 2 },
    { key: '4k', multiplier: 5 },
  ]
}

function defaultQualities(generationType: string, model?: string): QualityEntry[] {
  if (generationType === 'IMAGE') {
    return []
  }
  // Agnes Video V2.0 不支持 quality 参数，不默认生成 quality 定价规则
  if (model === 'agnes-video-v2.0') {
    return []
  }
  // 其他视频模型保留历史默认值
  return [
    { key: 'standard', multiplier: 1 },
    { key: 'high', multiplier: 2 },
  ]
}

function defaultFps(model?: string): FpsEntry[] {
  // Agnes Video V2.0 不配置 fps multiplier：
  // duration = num_frames / frame_rate 已经自然反映了 fps 的影响，
  // 额外的 fpsMultiplier 属于重复计费。Agnes 官方价格未声明不同 FPS 具有不同单价。
  if (model === 'agnes-video-v2.0') {
    return []
  }
  // 其他视频模型保留历史默认值
  return [
    { key: '24', multiplier: 1 },
    { key: '30', multiplier: 1.2 },
    { key: '60', multiplier: 2 },
  ]
}

// ---------------------------------------------------------------------------
// Pricing table for a single generation type
// ---------------------------------------------------------------------------

function PricingTable({
  generationType,
  onRefresh,
  refreshKey,
}: {
  generationType: 'IMAGE' | 'VIDEO'
  onRefresh: () => void
  refreshKey: number
}) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<AdminModelPricingView[]>([])
  const [loading, setLoading] = useState(true)
  const [editTarget, setEditTarget] = useState<AdminModelPricingView | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminPricingApi.modelOverview({ generationType })
      setRows(data)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [generationType, message])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const handlePublishSuccess = (result: { versionId: string; version: number }) => {
    const target = editTarget
    setEditTarget(null)
    message.success(
      `动态规则发布成功：${target?.displayName ?? ''} → v${result.version}`,
    )
    void load()
    onRefresh()
  }

  const renderRulesSummary = (r: AdminModelPricingView) => {
    if (!r.isDynamic || !r.dynamicRules) {
      return r.currentCredits != null ? (
        <span className="text-cyan-600 font-medium">{r.currentCredits} Credits</span>
      ) : (
        <span className="text-gray-400">—</span>
      )
    }
    const rules = r.dynamicRules as Record<string, unknown>
    const base = Number(rules.baseCredits ?? rules.base_credits ?? 0)
    const duration = rules.duration as { pricePerSecond?: number } | undefined
    const size = rules.size as Record<string, number> | undefined
    const resolution = rules.resolution as Record<string, number> | undefined
    const quality = rules.quality as Record<string, number> | undefined
    const fps = rules.fps as Record<string, number> | undefined

    return (
      <div className="text-xs text-gray-600 space-y-0.5">
        <div>基础: <span className="font-medium text-cyan-600">{base}</span> credits</div>
        {duration?.pricePerSecond && (
          <div>时长: <span className="font-medium">{duration.pricePerSecond}</span> credits/秒</div>
        )}
        {size && (
          <div>
            尺寸: {Object.entries(size).map(([k, v]) => (
              <span key={k} className="mr-2">{k} x{v}</span>
            ))}
          </div>
        )}
        {resolution && (
          <div>
            分辨率: {Object.entries(resolution).map(([k, v]) => (
              <span key={k} className="mr-2">{k} x{v}</span>
            ))}
          </div>
        )}
        {quality && (
          <div>
            质量: {Object.entries(quality).map(([k, v]) => (
              <span key={k} className="mr-2">{k} x{v}</span>
            ))}
          </div>
        )}
        {fps && (
          <div>
            FPS: {Object.entries(fps).map(([k, v]) => (
              <span key={k} className="mr-2">{k} x{v}</span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const columns: TableProps<AdminModelPricingView>['columns'] = [
    {
      title: '模型',
      dataIndex: 'displayName',
      key: 'model',
      render: (displayName: string, r) => (
        <div>
          <div className="font-medium text-gray-900 text-sm">{displayName}</div>
          <div className="text-xs text-gray-400 font-mono">{r.model}</div>
        </div>
      ),
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      key: 'provider',
      width: 100,
      render: (provider: string) => <Tag color="blue">{provider}</Tag>,
    },
    {
      title: '定价模式',
      key: 'pricingMode',
      width: 100,
      render: (_, r) =>
        r.isDynamic ? (
          <Tag color="purple">动态定价</Tag>
        ) : (
          <Tag color="cyan">固定价格</Tag>
        ),
    },
    {
      title: '动态规则 / 当前 Credits',
      key: 'rules',
      render: (_, r) => renderRulesSummary(r),
    },
    {
      title: 'Version',
      key: 'currentVersion',
      width: 80,
      render: (_, r) =>
        r.currentVersion != null ? (
          <span className="text-gray-600">v{r.currentVersion}</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => <PricingStatusBadge status={status} />,
    },
    {
      title: '发布时间',
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 140,
      render: (v: string | null) => (
        <span className="text-xs text-gray-500">{fmtDate(v)}</span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          onClick={() => setEditTarget(r)}
        >
          {r.status === 'UNCONFIGURED' ? '配置规则' : '编辑规则'}
        </Button>
      ),
    },
  ]

  if (loading && rows.length === 0) {
    return (
      <div className="p-5">
        <Skeleton active paragraph={{ rows: 3 }} />
      </div>
    )
  }

  return (
    <div>
      <Table<AdminModelPricingView>
        rowKey={(r) => `${r.generationType}:${r.provider}:${r.model}`}
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="middle"
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '没有模型数据' }}
      />
      <DynamicPricingModal
        model={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={handlePublishSuccess}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

type TabKey = 'image' | 'video'

export default function AdminPricingView() {
  const { message } = App.useApp()
  const [activeTab, setActiveTab] = useState<TabKey>('image')
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const handleManualRefresh = () => {
    setRefreshKey((k) => k + 1)
    message.success('已刷新')
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="定价管理" />
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            管理图片和视频生成模型的动态定价规则。根据尺寸、分辨率、时长、质量等参数动态计算 Credits。
          </p>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleManualRefresh}
            loading={false}
          >
            刷新
          </Button>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
          items={[
            {
              key: 'image',
              label: '图片',
              children: (
                <PricingTable
                  generationType="IMAGE"
                  onRefresh={handleRefresh}
                  refreshKey={refreshKey}
                />
              ),
            },
            {
              key: 'video',
              label: '视频',
              children: (
                <PricingTable
                  generationType="VIDEO"
                  onRefresh={handleRefresh}
                  refreshKey={refreshKey}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}
