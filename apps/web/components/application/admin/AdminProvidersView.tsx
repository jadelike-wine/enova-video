'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Card,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  InputNumber,
} from 'antd'
import type { MenuProps, TableProps } from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  EllipsisOutlined,
  EditOutlined,
  KeyOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import {
  adminProvidersApi,
  adminCredentialsApi,
  type AdminProviderView,
  type AdminCredentialView,
  type CreateProviderInput,
  type UpdateProviderInput,
  type CreateCredentialInput,
  type UpdateCredentialInput,
} from '../../../lib/adminApi'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { useTablePagination } from '../../../lib/useTablePagination'
import { useSession } from '../../../lib/auth'
import { fmtDate } from './AdminUi'

// ---------------------------------------------------------------------------
// Provider status badge
// ---------------------------------------------------------------------------

function ProviderStatusBadge({ status }: { status: string }) {
  const s = (status ?? '').toUpperCase()
  if (s === 'ACTIVE') return <Tag color="success">正常</Tag>
  if (s === 'DISABLED') return <Tag color="default">停用</Tag>
  return <Tag color="error">异常</Tag>
}

// ---------------------------------------------------------------------------
// Credential status badge
// ---------------------------------------------------------------------------

function CredentialStatusBadge({ status }: { status: string }) {
  const s = (status ?? '').toUpperCase()
  const map: Record<string, { color: string; text: string }> = {
    ACTIVE: { color: 'success', text: '正常' },
    COOLDOWN: { color: 'warning', text: '冷却' },
    ERROR: { color: 'error', text: '异常' },
    DISABLED: { color: 'default', text: '停用' },
  }
  const cfg = map[s] ?? { color: 'default', text: s || '—' }
  return <Tag color={cfg.color}>{cfg.text}</Tag>
}

// ---------------------------------------------------------------------------
// Friendly time (e.g. "7 分钟前")
// ---------------------------------------------------------------------------

function friendlyTime(v: string | Date | null | undefined): string {
  if (!v) return '从未使用'
  const d = typeof v === 'string' ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 25_9200_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return fmtDate(v)
}


// ---------------------------------------------------------------------------
// Provider Form Drawer (Add / Edit)
// ---------------------------------------------------------------------------

interface ProviderFormValues {
  code: string
  name: string
  baseUrl: string
  status: string
  configText: string
}

function ProviderFormDrawer({
  open,
  mode,
  provider,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean
  mode: 'create' | 'edit'
  provider: AdminProviderView | null
  onClose: () => void
  onSubmit: (values: CreateProviderInput | UpdateProviderInput) => Promise<void>
  submitting: boolean
}) {
  const [form] = Form.useForm<ProviderFormValues>()
  const isCreate = mode === 'create'

  // Reset form when drawer opens
  useEffect(() => {
    if (!open) return
    if (isCreate) {
      form.resetFields()
      form.setFieldsValue({
        code: '',
        name: '',
        baseUrl: '',
        status: 'ACTIVE',
        configText: '',
      })
    } else if (provider) {
      form.setFieldsValue({
        code: provider.code,
        name: provider.name,
        baseUrl: provider.baseUrl,
        status: provider.status,
        configText: provider.config ? JSON.stringify(provider.config, null, 2) : '',
      })
    }
  }, [open, isCreate, provider, form])

  const handleSubmit = async (values: ProviderFormValues) => {
    let config: Record<string, unknown> | undefined
    const configStr = values.configText?.trim()
    if (configStr) {
      try {
        config = JSON.parse(configStr)
      } catch {
        form.setFields([
          { name: 'configText', errors: ['JSON 格式错误'] },
        ])
        return
      }
    }

    if (isCreate) {
      await onSubmit({
        code: values.code.trim(),
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        status: values.status,
        config,
      })
    } else {
      await onSubmit({
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        status: values.status,
        config,
      })
    }
  }

  return (
    <Drawer
      title={isCreate ? '添加 Provider' : '编辑 Provider'}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            {isCreate ? '创建' : '保存'}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ status: 'ACTIVE', configText: '' }}
      >
        <Form.Item
          name="code"
          label="Provider Code"
          rules={[{ required: true, message: '请输入 Provider Code' }]}
        >
          <Input placeholder="例如：openai" disabled={!isCreate} />
        </Form.Item>

        <Form.Item
          name="name"
          label="Provider 名称"
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input placeholder="例如：OpenAI" />
        </Form.Item>

        <Form.Item
          name="baseUrl"
          label="Base URL"
          rules={[
            { required: true, message: '请输入 Base URL' },
            {
              validator: async (_, value) => {
                if (!value) return
                try {
                  const url = new URL(value)
                  if (!['https:', 'http:'].includes(url.protocol)) {
                    throw new Error('仅支持 http/https 协议')
                  }
                } catch {
                  throw new Error('请输入合法的 URL')
                }
              },
            },
          ]}
        >
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>

        <Form.Item name="status" label="状态">
          <Select
            options={[
              { value: 'ACTIVE', label: '正常' },
              { value: 'DISABLED', label: '停用' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="configText"
          label="Config (JSON, 可选)"
          tooltip="Provider 额外配置，JSON 格式"
        >
          <Input.TextArea
            placeholder='{ "key": "value" }'
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
        </Form.Item>
      </Form>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Credential Form (inside Credential Drawer)
// ---------------------------------------------------------------------------

interface CredentialFormValues {
  secret: string
  status: string
  priority: number
  weight: number
  maxConcurrency: number
  clearBackoff?: boolean
}

function CredentialFormModal({
  open,
  mode,
  credential,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean
  mode: 'create' | 'edit'
  credential: AdminCredentialView | null
  onClose: () => void
  onSubmit: (values: CreateCredentialInput | UpdateCredentialInput) => Promise<void>
  submitting: boolean
}) {
  const [form] = Form.useForm<CredentialFormValues>()
  const isCreate = mode === 'create'

  useEffect(() => {
    if (!open) return
    if (isCreate) {
      form.resetFields()
      form.setFieldsValue({
        secret: '',
        status: 'ACTIVE',
        priority: 0,
        weight: 1,
        maxConcurrency: 1,
        clearBackoff: false,
      })
    } else if (credential) {
      form.setFieldsValue({
        secret: '',
        status: credential.status,
        priority: credential.priority,
        weight: credential.weight,
        maxConcurrency: credential.maxConcurrency,
        clearBackoff: false,
      })
    }
  }, [open, isCreate, credential, form])

  const handleSubmit = async (values: CredentialFormValues) => {
    if (isCreate) {
      await onSubmit({
        secret: values.secret,
        status: values.status,
        priority: values.priority,
        weight: values.weight,
        maxConcurrency: values.maxConcurrency,
      })
    } else {
      const update: UpdateCredentialInput = {
        status: values.status,
        priority: values.priority,
        weight: values.weight,
        maxConcurrency: values.maxConcurrency,
      }
      if (values.secret?.trim()) {
        update.secret = values.secret
      }
      if (values.clearBackoff) {
        update.clearBackoff = true
      }
      await onSubmit(update)
    }
  }

  return (
    <Modal
      title={isCreate ? '添加 API Key' : '编辑 API Key'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={isCreate ? '创建' : '保存'}
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="secret"
          label="API Key / Secret"
          rules={isCreate ? [{ required: true, message: '请输入 API Key' }] : []}
          extra={!isCreate ? '留空则保持当前 API Key 不变' : undefined}
        >
          <Input.Password
            placeholder={isCreate ? 'sk-...' : '••••••••（留空保持不变）'}
          />
        </Form.Item>

        <Form.Item name="status" label="状态">
          <Select
            options={[
              { value: 'ACTIVE', label: '正常' },
              { value: 'COOLDOWN', label: '冷却' },
              { value: 'ERROR', label: '异常' },
              { value: 'DISABLED', label: '停用' },
            ]}
          />
        </Form.Item>

        <div className="grid grid-cols-3 gap-4">
          <Form.Item name="priority" label="优先级">
            <InputNumber className="w-full" />
          </Form.Item>
          <Form.Item name="weight" label="权重">
            <InputNumber className="w-full" min={1} />
          </Form.Item>
          <Form.Item name="maxConcurrency" label="最大并发">
            <InputNumber className="w-full" min={1} max={100} />
          </Form.Item>
        </div>

        {!isCreate && (
          <Form.Item name="clearBackoff" valuePropName="checked">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <Switch size="small" />
              清除冷却/错误状态（手动恢复）
            </label>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Credential Drawer
// ---------------------------------------------------------------------------

function CredentialDrawer({
  open,
  provider,
  onClose,
  onChanged,
}: {
  open: boolean
  provider: AdminProviderView | null
  onClose: () => void
  onChanged: () => void
}) {
  const { message } = App.useApp()
  const [credentials, setCredentials] = useState<AdminCredentialView[]>([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editTarget, setEditTarget] = useState<AdminCredentialView | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminCredentialView | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadCredentials = useCallback(async () => {
    if (!provider) return
    setLoading(true)
    try {
      const rows = await adminCredentialsApi.listByProvider(provider.id)
      setCredentials(rows)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [provider, message])

  useEffect(() => {
    if (open && provider) {
      void loadCredentials()
    }
  }, [open, provider, loadCredentials])

  const handleCreate = () => {
    setFormMode('create')
    setEditTarget(null)
    setFormOpen(true)
  }

  const handleEdit = (cred: AdminCredentialView) => {
    setFormMode('edit')
    setEditTarget(cred)
    setFormOpen(true)
  }

  const handleSubmitCredential = async (values: CreateCredentialInput | UpdateCredentialInput) => {
    if (!provider) return
    setSubmitting(true)
    try {
      if (formMode === 'create') {
        await adminCredentialsApi.create(provider.id, values as CreateCredentialInput)
        message.success('API Key 已创建')
      } else if (editTarget) {
        await adminCredentialsApi.update(editTarget.id, values as UpdateCredentialInput)
        message.success('API Key 已更新')
      }
      setFormOpen(false)
      await loadCredentials()
      onChanged()
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await adminCredentialsApi.delete(deleteTarget.id)
      message.success('API Key 已删除')
      setDeleteTarget(null)
      await loadCredentials()
      onChanged()
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  const activeCount = credentials.filter((c) => c.status === 'ACTIVE').length

  return (
    <>
      <Drawer
        title={
          provider ? (
            <div>
              <div className="font-semibold">{provider.name} · API 凭证</div>
              <div className="text-xs text-gray-400 font-normal mt-0.5 truncate max-w-[400px]">
                {provider.baseUrl}
              </div>
            </div>
          ) : (
            'API 凭证'
          )
        }
        open={open}
        onClose={onClose}
        width={560}
        destroyOnClose
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            添加 API Key
          </Button>
        }
      >
        {loading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : credentials.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <KeyOutlined style={{ fontSize: 32 }} />
            <p className="mt-3 text-sm">暂无 API 凭证</p>
            <p className="mt-1 text-xs">添加 API Key 后，系统才能调用该 Provider</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-500 mb-2">
              共 {credentials.length} 个密钥，{activeCount} 正常
            </div>
            {credentials.map((cred) => (
              <div
                key={cred.id}
                className="rounded-lg border border-gray-100 p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">
                      Credential #{cred.id.slice(0, 8)}
                    </span>
                    {cred.hasSecret ? (
                      <Tag color="blue">sk-••••••••</Tag>
                    ) : (
                      <Tag color="warning">无密钥</Tag>
                    )}
                  </div>
                  <CredentialStatusBadge status={cred.status} />
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 mb-2">
                  <span>优先级 {cred.priority}</span>
                  <span>权重 {cred.weight}</span>
                  <span>最大并发 {cred.maxConcurrency}</span>
                  <span>当前并发 {cred.currentConcurrency}</span>
                </div>

                {cred.lastError && (
                  <div className="text-xs text-red-500 mb-1 truncate">
                    错误：{cred.lastError}
                  </div>
                )}

                {cred.cooldownUntil && (
                  <div className="text-xs text-orange-500 mb-1">
                    冷却至 {fmtDate(cred.cooldownUntil)}
                  </div>
                )}

                <div className="text-xs text-gray-400 mb-3">
                  最近使用：{friendlyTime(cred.lastUsedAt)}
                </div>

                <div className="flex justify-end gap-2">
                  <Button size="small" onClick={() => handleEdit(cred)}>
                    编辑
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => setDeleteTarget(cred)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <CredentialFormModal
        open={formOpen}
        mode={formMode}
        credential={editTarget}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmitCredential}
        submitting={submitting}
      />

      <Modal
        title="删除 API Key"
        open={!!deleteTarget}
        onOk={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
      >
        <div className="py-4">
          <p className="text-sm text-gray-600">
            删除后无法恢复，使用该凭证的任务将无法继续调度。
          </p>
        </div>
      </Modal>

    </>
  )
}

// ---------------------------------------------------------------------------
// Delete Provider Modal
// ---------------------------------------------------------------------------

function DeleteProviderModal({
  open,
  provider,
  onClose,
  onConfirm,
  deleting,
}: {
  open: boolean
  provider: AdminProviderView | null
  onClose: () => void
  onConfirm: () => Promise<void>
  deleting: boolean
}) {
  return (
    <Modal
      title="删除 Provider"
      open={open}
      onOk={onConfirm}
      onCancel={onClose}
      okText="确认删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      confirmLoading={deleting}
    >
      <div className="py-4 space-y-3">
        <p className="text-sm text-gray-700">
          删除 <strong>{provider?.name}</strong> 后，该 Provider 将无法继续承担新的生成任务。
        </p>
        <p className="text-sm text-gray-500">
          删除 Provider 会级联删除其所有 Credential。已有任务和历史记录不会因此消失。
        </p>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Add Agnes Account Modal (simplified: only API Key needed)
// ---------------------------------------------------------------------------

function AddAgnesAccountModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { message } = App.useApp()
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const key = apiKey.trim()
    if (!key) {
      message.warning('请输入 API Key')
      return
    }
    setSubmitting(true)
    try {
      await adminProvidersApi.createAgnesAccount(key)
      message.success('Agnes 账号已添加')
      setApiKey('')
      onClose()
      onSuccess()
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="添加 Agnes 账号"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      <div className="py-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
          <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-600">
            Agnes (agnes.com)
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
          <Input.Password
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-xxxxxxxxxxxxxxxx"
            onPressEnter={handleSubmit}
            autoFocus
          />
          <p className="mt-1 text-xs text-gray-400">
            API Key 将加密存储，不会暴露给前端
          </p>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Main AdminProvidersView
// ---------------------------------------------------------------------------

export default function AdminProvidersView() {
  const { message } = App.useApp()
  const { user } = useSession()
  const { defaultPageSize } = useTablePagination()

  const [providers, setProviders] = useState<AdminProviderView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Drawer / Modal state
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editTarget, setEditTarget] = useState<AdminProviderView | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Add Agnes account modal
  const [addAccountOpen, setAddAccountOpen] = useState(false)

  const [credDrawerOpen, setCredDrawerOpen] = useState(false)
  const [credTarget, setCredTarget] = useState<AdminProviderView | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<AdminProviderView | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Status toggle busy state
  const [busyId, setBusyId] = useState<string | null>(null)

  // Previous status for rollback
  const prevStatusRef = useRef<Record<string, string>>({})

  const load = useCallback(
    async (off: number) => {
      setLoading(true)
      try {
        const rows = await adminProvidersApi.list({ limit: defaultPageSize, offset: off })
        setProviders(rows)
        setOffset(off)
      } catch (e) {
        message.error(formatErrorMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [defaultPageSize, message],
  )

  useEffect(() => {
    void load(0)
  }, [load])

  // Client-side search & filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = providers
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          p.baseUrl.toLowerCase().includes(q),
      )
    }
    if (statusFilter) {
      result = result.filter((p) => p.status === statusFilter)
    }
    return result
  }, [providers, search, statusFilter])

  const handleAddAccount = () => {
    setAddAccountOpen(true)
  }

  const handleEdit = (provider: AdminProviderView) => {
    setFormMode('edit')
    setEditTarget(provider)
    setFormOpen(true)
  }

  const handleSubmitProvider = async (values: CreateProviderInput | UpdateProviderInput) => {
    setSubmitting(true)
    try {
      if (formMode === 'create') {
        await adminProvidersApi.create(values as CreateProviderInput)
        message.success('Provider 已创建')
      } else if (editTarget) {
        await adminProvidersApi.update(editTarget.id, values as UpdateProviderInput)
        message.success('Provider 已更新')
      }
      setFormOpen(false)
      await load(offset)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleStatus = async (provider: AdminProviderView) => {
    // 防重入：双击会污染回滚基准（第二次读到的 provider.status 已是乐观值）。
    if (busyId === provider.id) return
    const newStatus = provider.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    setBusyId(provider.id)
    // Optimistic update
    prevStatusRef.current[provider.id] = provider.status
    setProviders((prev) =>
      prev.map((p) => (p.id === provider.id ? { ...p, status: newStatus } : p)),
    )
    try {
      await adminProvidersApi.update(provider.id, { status: newStatus })
      message.success(`Provider 已${newStatus === 'ACTIVE' ? '启用' : '停用'}`)
    } catch (e) {
      // Rollback
      setProviders((prev) =>
        prev.map((p) =>
          p.id === provider.id ? { ...p, status: prevStatusRef.current[provider.id] ?? p.status } : p,
        ),
      )
      message.error(formatErrorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await adminProvidersApi.delete(deleteTarget.id)
      message.success('Provider 已删除')
      setDeleteTarget(null)
      await load(offset)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  const handleOpenCredentials = (provider: AdminProviderView) => {
    setCredTarget(provider)
    setCredDrawerOpen(true)
  }

  const handleCopyUrl = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => message.success('已复制 Base URL'))
      .catch(() => message.error('复制失败'))
  }

  // Non-admin guard
  if (user && user.role !== 'ADMIN') {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">仅管理员可访问 AI Provider 管理</p>
      </div>
    )
  }

  const columns: TableProps<AdminProviderView>['columns'] = [
    {
      title: '名称',
      key: 'name',
      width: 180,
      fixed: 'left' as const,
      render: (_, r) => (
        <div>
          <div className="font-medium text-gray-900 text-sm">{r.name}</div>
          <div className="text-xs text-gray-400">{r.code}</div>
        </div>
      ),
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      width: 240,
      render: (url: string) => (
        <div className="flex items-center gap-1">
          <Tooltip title={url}>
            <span className="text-xs text-gray-600 truncate max-w-[180px] inline-block align-bottom">
              {url.length > 32 ? `${url.slice(0, 32)}...` : url}
            </span>
          </Tooltip>
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => handleCopyUrl(url)}
          />
        </div>
      ),
    },
    {
      title: '凭证',
      key: 'credentials',
      width: 120,
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          onClick={() => handleOpenCredentials(r)}
        >
          管理凭证
        </Button>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: string) => <ProviderStatusBadge status={status} />,
    },
    {
      title: '启用',
      key: 'toggle',
      width: 70,
      render: (_, r) => (
        <Switch
          checked={r.status === 'ACTIVE'}
          loading={busyId === r.id}
          disabled={busyId === r.id}
          onChange={() => void handleToggleStatus(r)}
          size="small"
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (v: string) => <span className="text-xs text-gray-500">{fmtDate(v)}</span>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 140,
      render: (v: string) => <span className="text-xs text-gray-500">{fmtDate(v)}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right' as const,
      render: (_, r) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(r)}
          >
            编辑
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'credentials',
                  label: '管理凭证',
                  onClick: () => handleOpenCredentials(r),
                },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  onClick: () => setDeleteTarget(r),
                },
              ] as MenuProps['items'],
            }}
            trigger={['click']}
          >
            <Button type="link" size="small" icon={<EllipsisOutlined />}>
              更多
            </Button>
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="px-8 py-6 border-b border-gray-100">
        <h2 className="text-xl font-bold text-gray-900">AI Provider 管理</h2>
        <p className="mt-1 text-sm text-gray-500">
          管理图片、视频等 AI 服务的 API 地址、密钥和调度配置
        </p>
      </div>

      {/* Toolbar */}
      <div className="px-8 py-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-[240px]"
          placeholder="搜索名称、Code、Base URL..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={() => setSearch(searchInput)}
          allowClear
          onClear={() => setSearch('')}
        />
        <Select
          className="w-[140px]"
          placeholder="全部状态"
          value={statusFilter || undefined}
          onChange={(v) => setStatusFilter(v ?? '')}
          allowClear
          options={[
            { value: 'ACTIVE', label: '正常' },
            { value: 'DISABLED', label: '停用' },
          ]}
        />
        <div className="flex-1" />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void load(offset)}
          loading={loading}
        >
          刷新
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddAccount}>
          添加账号
        </Button>
      </div>

      {/* Table Card */}
      <div className="px-8 pb-8">
        <Card className="!rounded-xl" styles={{ body: { padding: 0 } }}>
          {loading && providers.length === 0 ? (
            <div className="p-6">
              <Skeleton active paragraph={{ rows: 5 }} />
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-100 text-sm text-gray-500">
                共 {filtered.length} 个 Provider
              </div>
              <Table<AdminProviderView>
                rowKey="id"
                columns={columns}
                dataSource={filtered}
                loading={loading}
                pagination={false}
                size="middle"
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: '暂无 AI Provider' }}
              />
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  第 {offset + 1} - {offset + filtered.length} 条
                </span>
                <Space>
                  <Button
                    size="small"
                    disabled={offset === 0 || loading}
                    onClick={() => void load(Math.max(0, offset - defaultPageSize))}
                  >
                    上一页
                  </Button>
                  <Button
                    size="small"
                    disabled={providers.length < defaultPageSize || loading}
                    onClick={() => void load(offset + defaultPageSize)}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Add Agnes Account Modal */}
      <AddAgnesAccountModal
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
        onSuccess={() => void load(offset)}
      />

      {/* Provider Form Drawer */}
      <ProviderFormDrawer
        open={formOpen}
        mode={formMode}
        provider={editTarget}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmitProvider}
        submitting={submitting}
      />

      {/* Credential Drawer */}
      <CredentialDrawer
        open={credDrawerOpen}
        provider={credTarget}
        onClose={() => setCredDrawerOpen(false)}
        onChanged={() => void load(offset)}
      />

      {/* Delete Provider Modal */}
      <DeleteProviderModal
        open={!!deleteTarget}
        provider={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        deleting={deleting}
      />
    </div>
  )
}
