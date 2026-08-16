'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Table,
  Tabs,
  Tag,
} from 'antd'
import type { TableProps } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import {
  adminPricingApi,
  type AdminModelPricingView,
  type PublishPricingVersionResult,
} from '../../../lib/adminApi'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { AdminApiError } from '../../../lib/adminApi'
import { PageHeader, fmtDate } from './AdminUi'

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
// Publish form modal
// ---------------------------------------------------------------------------

interface PublishFormValues {
  credits: number
  stepUpPassword: string
}

function PublishPricingModal({
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
  const [form] = Form.useForm<PublishFormValues>()
  const [submitting, setSubmitting] = useState(false)

  const isConfigured = model?.status === 'PUBLISHED'
  const currentCredits = model?.currentCredits

  const handleSubmit = async (values: PublishFormValues) => {
    if (!model) return
    if (!Number.isInteger(values.credits) || values.credits < 0) {
      message.warning('请输入非负整数 Credits')
      return
    }
    if (!values.stepUpPassword) {
      message.warning('请输入管理员密码以确认发布')
      return
    }
    setSubmitting(true)
    try {
      const result = await adminPricingApi.publishVersion(
        {
          generationType: model.generationType,
          provider: model.provider,
          model: model.model,
          credits: values.credits,
          pricingJson: {
            providerCostMicrousd: 0,
            estimatedRevenueCents: 0,
          },
        },
        values.stepUpPassword,
      )
      onSuccess(result)
    } catch (e) {
      const err = e as AdminApiError
      if (err.status === 403 && err.code === 'FORBIDDEN') {
        message.error('管理员密码不正确，请重新输入')
      } else {
        message.error(formatErrorMessage(e))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={`设置${model?.generationType === 'IMAGE' ? '图片' : '视频'}价格`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="发布价格"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
      afterOpenChange={(opened) => {
        if (opened) {
          form.resetFields()
          form.setFieldsValue({
            credits: currentCredits ?? undefined,
            stepUpPassword: '',
          })
        }
      }}
    >
      {model && (
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">模型</span>
              <span className="font-medium text-gray-900">{model.displayName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Provider</span>
              <span className="font-medium text-gray-900">{model.provider}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">当前价格</span>
              <span className="font-medium text-gray-900">
                {isConfigured ? `${currentCredits} Credits (v${model.currentVersion})` : '未配置'}
              </span>
            </div>
          </div>

          <Form.Item
            name="credits"
            label="生成一次扣除 Credits"
            rules={[
              { required: true, message: '请输入 Credits 数量' },
              {
                validator: async (_, value) => {
                  if (!Number.isInteger(value) || value < 0) {
                    throw new Error('请输入非负整数 Credits')
                  }
                },
              },
            ]}
          >
            <InputNumber
              className="w-full"
              placeholder="例如：100"
              min={0}
              precision={0}
            />
          </Form.Item>

          <div className="mb-2 p-3 bg-amber-50 rounded text-xs text-amber-700">
            发布后，新生成任务将使用新 Credits 进行报价。历史报价和历史任务不会受到影响。
          </div>

          <Form.Item
            name="stepUpPassword"
            label="管理员密码（Step-up 验证）"
            rules={[{ required: true, message: '请输入管理员密码' }]}
          >
            <Input.Password placeholder="输入您的登录密码以确认发布" autoComplete="off" />
          </Form.Item>
        </Form>
      )}
    </Modal>
  )
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
  const [publishTarget, setPublishTarget] = useState<AdminModelPricingView | null>(null)

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
    const target = publishTarget
    setPublishTarget(null)
    message.success(
      `价格发布成功：${target?.displayName ?? ''} → ${target?.currentCredits ?? '—'} Credits (v${result.version})`,
    )
    void load()
    onRefresh()
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
      title: '当前 Credits',
      key: 'currentCredits',
      width: 120,
      render: (_, r) =>
        r.currentCredits != null ? (
          <span className="text-cyan-600 font-medium">{r.currentCredits}</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
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
          onClick={() => setPublishTarget(r)}
        >
          {r.status === 'UNCONFIGURED' ? '设置价格' : '修改价格'}
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
      <PublishPricingModal
        model={publishTarget}
        open={!!publishTarget}
        onClose={() => setPublishTarget(null)}
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
            管理图片和视频生成模型的价格（Credits）。发布新价格后，新生成任务将使用最新价格报价。
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
