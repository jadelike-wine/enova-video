'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Card,
  Collapse,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { MenuProps, TableProps } from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  EllipsisOutlined,
  EditOutlined,
  SettingOutlined,
  ApiOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
} from '@ant-design/icons'
import {
  adminProvidersApi,
  adminCredentialsApi,
  adminAccountsApi,
  type AdminProviderView,
  type AdminAccountRow,
  type UpdateCredentialInput,
  type AdminTestConnectionResult,
  type TestConnectionInput,
} from '../../../lib/adminApi'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { useTablePagination } from '../../../lib/useTablePagination'
import { useSession } from '../../../lib/auth'
import { fmtDate } from './AdminUi'

const { Text } = Typography

// ---------------------------------------------------------------------------
// Credential health status badge
// ---------------------------------------------------------------------------

function HealthStatusBadge({ status }: { status: string }) {
  const s = (status ?? '').toUpperCase()
  const map: Record<string, { color: string; text: string }> = {
    ACTIVE: { color: 'success', text: '正常' },
    COOLDOWN: { color: 'warning', text: '冷却中' },
    ERROR: { color: 'error', text: '异常' },
    DISABLED: { color: 'default', text: '已禁用' },
  }
  const cfg = map[s] ?? { color: 'default', text: s || '—' }
  return <Tag color={cfg.color}>{cfg.text}</Tag>
}

function ProviderStatusBadge({ status }: { status: string }) {
  const s = (status ?? '').toUpperCase()
  if (s === 'ACTIVE') return <Tag color="success">正常</Tag>
  if (s === 'DISABLED') return <Tag color="default">停用</Tag>
  return <Tag color="error">异常</Tag>
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
// Account Form Modal (Add / Edit)
// ---------------------------------------------------------------------------

interface AccountFormValues {
  providerCode: string
  name: string
  secret: string
  remark: string
  enabled: boolean
  priority: number
  weight: number
  maxConcurrency: number
}

function AccountFormModal({
  open,
  mode,
  account,
  providers,
  onClose,
  onSubmit,
  submitting,
  onTestConnection,
  testing,
  testResult,
}: {
  open: boolean
  mode: 'create' | 'edit'
  account: AdminAccountRow | null
  providers: AdminProviderView[]
  onClose: () => void
  onSubmit: (values: AccountFormValues) => Promise<void>
  submitting: boolean
  onTestConnection: (secret: string, baseUrl?: string) => void
  testing: boolean
  testResult: AdminTestConnectionResult | null
}) {
  const [form] = Form.useForm<AccountFormValues>()
  const isCreate = mode === 'create'
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    if (isCreate) {
      form.resetFields()
      form.setFieldsValue({
        providerCode: 'agnes',
        name: '',
        secret: '',
        remark: '',
        enabled: true,
        priority: 0,
        weight: 1,
        maxConcurrency: 1,
      })
      setAdvancedOpen(false)
    } else if (account) {
      form.setFieldsValue({
        providerCode: account.providerCode,
        name: account.name ?? '',
        secret: '',
        remark: account.remark ?? '',
        enabled: account.status !== 'DISABLED',
        priority: account.priority,
        weight: account.weight,
        maxConcurrency: account.maxConcurrency,
      })
      setAdvancedOpen(false)
    }
  }, [open, isCreate, account, form])

  const handleSubmit = async (values: AccountFormValues) => {
    await onSubmit(values)
  }

  const handleTest = () => {
    const secret = form.getFieldValue('secret')?.trim()
    if (!secret && isCreate) return
    const providerCode = form.getFieldValue('providerCode')
    const provider = providers.find((p) => p.code === providerCode)
    onTestConnection(secret, provider?.baseUrl)
  }

  return (
    <Modal
      title={isCreate ? '添加账号' : '编辑账号'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={isCreate ? '创建' : '保存'}
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
      width={560}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="providerCode"
          label="Provider"
          rules={[{ required: true, message: '请选择 Provider' }]}
        >
          <Select
            placeholder="选择 Provider"
            disabled={!isCreate && !!account}
            options={providers.map((p) => ({
              value: p.code,
              label: `${p.name} (${p.code})`,
            }))}
          />
        </Form.Item>

        <Form.Item
          name="name"
          label="账号名称"
          rules={[{ required: true, message: '请输入账号名称' }]}
        >
          <Input placeholder="例如：Agnes 主账号" />
        </Form.Item>

        <Form.Item
          name="secret"
          label="API Key"
          rules={isCreate ? [{ required: true, message: '请输入 API Key' }] : []}
          extra={!isCreate ? '留空则保持当前 API Key 不变' : undefined}
        >
          <Input.Password
            placeholder={isCreate ? 'sk-...' : '••••••••（留空保持不变）'}
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <Input.TextArea
            placeholder="例如：生产环境主账号，购买于官方渠道。"
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
        </Form.Item>

        {!isCreate && (
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        )}

        {/* 测试连接 */}
        <div className="mb-4">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button
              icon={<ApiOutlined />}
              onClick={handleTest}
              loading={testing}
              disabled={isCreate && !form.getFieldValue('secret')}
            >
              测试连接
            </Button>
            {testResult && (
              <div className="flex items-center gap-2 text-sm">
                {testResult.success ? (
                  <CheckCircleTwoTone twoToneColor="#52c41a" />
                ) : (
                  <CloseCircleTwoTone twoToneColor="#ff4d4f" />
                )}
                <Text type={testResult.success ? 'success' : 'danger'}>
                  {testResult.message}
                </Text>
              </div>
            )}
          </Space>
        </div>

        <Collapse
          ghost
          activeKey={advancedOpen ? ['adv'] : []}
          onChange={(keys) => setAdvancedOpen(keys.includes('adv'))}
          items={[{
            key: 'adv',
            label: '高级设置',
            children: (
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
            ),
          }]}
        />
      </Form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Provider Config Drawer (渠道配置)
// ---------------------------------------------------------------------------

interface ProviderFormValues {
  code: string
  name: string
  baseUrl: string
  status: string
  configText: string
}

function ProviderConfigDrawer({
  open,
  onClose,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { message } = App.useApp()
  const [providers, setProviders] = useState<AdminProviderView[]>([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editTarget, setEditTarget] = useState<AdminProviderView | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminProviderView | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [form] = Form.useForm<ProviderFormValues>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await adminProvidersApi.list({ limit: 100, offset: 0 })
      setProviders(rows)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const handleCreate = () => {
    setFormMode('create')
    setEditTarget(null)
    form.resetFields()
    form.setFieldsValue({ code: '', name: '', baseUrl: '', status: 'ACTIVE', configText: '' })
    setFormOpen(true)
  }

  const handleEdit = (provider: AdminProviderView) => {
    setFormMode('edit')
    setEditTarget(provider)
    form.setFieldsValue({
      code: provider.code,
      name: provider.name,
      baseUrl: provider.baseUrl,
      status: provider.status,
      configText: provider.config ? JSON.stringify(provider.config, null, 2) : '',
    })
    setFormOpen(true)
  }

  const handleSubmit = async (values: ProviderFormValues) => {
    let config: Record<string, unknown> | undefined
    const configStr = values.configText?.trim()
    if (configStr) {
      try {
        config = JSON.parse(configStr)
      } catch {
        form.setFields([{ name: 'configText', errors: ['JSON 格式错误'] }])
        return
      }
    }

    setSubmitting(true)
    try {
      if (formMode === 'create') {
        await adminProvidersApi.create({
          code: values.code.trim(),
          name: values.name.trim(),
          baseUrl: values.baseUrl.trim(),
          status: values.status,
          config,
        })
        message.success('Provider 已创建')
      } else if (editTarget) {
        await adminProvidersApi.update(editTarget.id, {
          name: values.name.trim(),
          baseUrl: values.baseUrl.trim(),
          status: values.status,
          config,
        })
        message.success('Provider 已更新')
      }
      setFormOpen(false)
      await load()
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
      await adminProvidersApi.delete(deleteTarget.id)
      message.success('Provider 已删除')
      setDeleteTarget(null)
      await load()
      onChanged()
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  const columns: TableProps<AdminProviderView>['columns'] = [
    {
      title: '名称',
      key: 'name',
      width: 140,
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
        <Tooltip title={url}>
          <span className="text-xs text-gray-600 truncate max-w-[200px] inline-block align-bottom">
            {url.length > 36 ? `${url.slice(0, 36)}...` : url}
          </span>
        </Tooltip>
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
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, r) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>
            编辑
          </Button>
          <Dropdown
            menu={{
              items: [
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
    <Drawer
      title="渠道配置"
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          添加 Provider
        </Button>
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <Table<AdminProviderView>
          rowKey="id"
          columns={columns}
          dataSource={providers}
          pagination={false}
          size="middle"
          locale={{ emptyText: '暂无 Provider 配置' }}
        />
      )}

      {/* Provider Form Modal */}
      <Modal
        title={formMode === 'create' ? '添加 Provider' : '编辑 Provider'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => form.submit()}
        okText={formMode === 'create' ? '创建' : '保存'}
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="code"
            label="Provider Code"
            rules={[{ required: true, message: '请输入 Provider Code' }]}
          >
            <Input placeholder="例如：agnes" disabled={formMode === 'edit'} />
          </Form.Item>

          <Form.Item
            name="name"
            label="Provider 名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如：Agnes" />
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
            <Input placeholder="https://apihub.agnes-ai.com" />
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
      </Modal>

      {/* Delete Provider Modal */}
      <Modal
        title="删除 Provider"
        open={!!deleteTarget}
        onOk={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
      >
        <div className="py-4 space-y-3">
          <p className="text-sm text-gray-700">
            删除 <strong>{deleteTarget?.name}</strong> 后，该 Provider 将无法继续承担新的生成任务。
          </p>
          <p className="text-sm text-gray-500">
            删除 Provider 会级联删除其所有账号。已有任务和历史记录不会因此消失。
          </p>
        </div>
      </Modal>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Delete Account Modal
// ---------------------------------------------------------------------------

function DeleteAccountModal({
  open,
  account,
  onClose,
  onConfirm,
  deleting,
}: {
  open: boolean
  account: AdminAccountRow | null
  onClose: () => void
  onConfirm: () => Promise<void>
  deleting: boolean
}) {
  return (
    <Modal
      title="删除账号"
      open={open}
      onOk={onConfirm}
      onCancel={onClose}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      confirmLoading={deleting}
    >
      <div className="py-4 space-y-3">
        <p className="text-sm text-gray-700">
          删除账号 <strong>{account?.name || account?.maskedApiKey || account?.id.slice(0, 8)}</strong> 后，该 API Key 将无法继续调度。
        </p>
        <p className="text-sm text-gray-500">
          删除后无法恢复，使用该凭证的任务将无法继续调度。
        </p>
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

  const [accounts, setAccounts] = useState<AdminAccountRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [providerFilter, setProviderFilter] = useState('')

  // Providers list (for provider filter dropdown and account form)
  const [providers, setProviders] = useState<AdminProviderView[]>([])

  // Account form modal state
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editTarget, setEditTarget] = useState<AdminAccountRow | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Test connection state
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AdminTestConnectionResult | null>(null)

  // Delete account state
  const [deleteTarget, setDeleteTarget] = useState<AdminAccountRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Provider config drawer state
  const [providerConfigOpen, setProviderConfigOpen] = useState(false)

  // Status toggle busy state
  const [busyId, setBusyId] = useState<string | null>(null)
  const prevStatusRef = useRef<Record<string, string>>({})

  const load = useCallback(
    async (off: number) => {
      setLoading(true)
      try {
        const { items, total: t } = await adminAccountsApi.list({
          limit: defaultPageSize,
          offset: off,
          search: search || undefined,
          status: statusFilter || undefined,
          providerCode: providerFilter || undefined,
        })
        setAccounts(items)
        setTotal(t)
        setOffset(off)
      } catch (e) {
        message.error(formatErrorMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [defaultPageSize, message, search, statusFilter, providerFilter],
  )

  const loadProviders = useCallback(async () => {
    try {
      const rows = await adminProvidersApi.list({ limit: 100, offset: 0 })
      setProviders(rows)
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    void load(0)
    void loadProviders()
  }, [load, loadProviders])

  // Client-side search & filter (supplements server-side filtering)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = accounts
    if (q) {
      result = result.filter(
        (a) =>
          (a.name ?? '').toLowerCase().includes(q) ||
          a.providerName.toLowerCase().includes(q) ||
          a.providerCode.toLowerCase().includes(q) ||
          a.providerBaseUrl.toLowerCase().includes(q),
      )
    }
    if (statusFilter) {
      result = result.filter((a) => a.status === statusFilter)
    }
    if (providerFilter) {
      result = result.filter((a) => a.providerCode === providerFilter)
    }
    return result
  }, [accounts, search, statusFilter, providerFilter])

  const handleAddAccount = () => {
    setFormMode('create')
    setEditTarget(null)
    setTestResult(null)
    setFormOpen(true)
  }

  const handleEdit = (account: AdminAccountRow) => {
    setFormMode('edit')
    setEditTarget(account)
    setTestResult(null)
    setFormOpen(true)
  }

  const handleSubmitAccount = async (values: AccountFormValues) => {
    setSubmitting(true)
    try {
      if (formMode === 'create') {
        // Use the agnes shortcut if provider is agnes, otherwise use generic credential create
        if (values.providerCode === 'agnes') {
          await adminProvidersApi.createAgnesAccount({
            apiKey: values.secret,
            name: values.name,
            remark: values.remark,
            priority: values.priority,
            weight: values.weight,
            maxConcurrency: values.maxConcurrency,
          })
        } else {
          // Find provider by code
          const provider = providers.find((p) => p.code === values.providerCode)
          if (!provider) {
            message.error('Provider 不存在')
            return
          }
          await adminCredentialsApi.create(provider.id, {
            secret: values.secret,
            name: values.name,
            remark: values.remark,
            priority: values.priority,
            weight: values.weight,
            maxConcurrency: values.maxConcurrency,
          })
        }
        message.success('账号已创建')
      } else if (editTarget) {
        const update: UpdateCredentialInput = {
          name: values.name,
          remark: values.remark,
          status: values.enabled ? 'ACTIVE' : 'DISABLED',
          priority: values.priority,
          weight: values.weight,
          maxConcurrency: values.maxConcurrency,
        }
        if (values.secret?.trim()) {
          update.secret = values.secret
        }
        await adminCredentialsApi.update(editTarget.id, update)
        message.success('账号已更新')
      }
      setFormOpen(false)
      await load(offset)
      await loadProviders()
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleTestConnection = async (secret: string, baseUrl?: string) => {
    if (!secret && formMode === 'create') {
      message.warning('请先输入 API Key')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      if (formMode === 'edit' && editTarget && !secret) {
        // Test saved credential
        const result = await adminAccountsApi.testConnectionById(editTarget.id)
        setTestResult(result)
      } else {
        const input: TestConnectionInput = { secret }
        if (baseUrl) input.baseUrl = baseUrl
        const providerCode = providers.find((p) => p.baseUrl === baseUrl)?.code
        if (providerCode) input.providerCode = providerCode
        const result = await adminAccountsApi.testConnection(input)
        setTestResult(result)
      }
    } catch (e) {
      setTestResult({
        success: false,
        message: formatErrorMessage(e),
      })
    } finally {
      setTesting(false)
    }
  }

  const handleTestConnectionById = async (account: AdminAccountRow) => {
    const hide = message.loading('正在测试连接...', 0)
    try {
      const result = await adminAccountsApi.testConnectionById(account.id)
      hide()
      if (result.success) {
        message.success(result.message)
      } else {
        message.error(result.message)
      }
    } catch (e) {
      hide()
      message.error(formatErrorMessage(e))
    }
  }

  const handleToggleEnabled = async (account: AdminAccountRow) => {
    if (busyId === account.id) return
    const newStatus = account.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED'
    setBusyId(account.id)
    prevStatusRef.current[account.id] = account.status
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, status: newStatus } : a)),
    )
    try {
      await adminCredentialsApi.update(account.id, { status: newStatus })
      message.success(`账号已${newStatus === 'ACTIVE' ? '启用' : '停用'}`)
    } catch (e) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id ? { ...a, status: prevStatusRef.current[account.id] ?? a.status } : a,
        ),
      )
      message.error(formatErrorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const handleClearBackoff = async (account: AdminAccountRow) => {
    try {
      await adminCredentialsApi.update(account.id, { clearBackoff: true })
      message.success('已清除冷却/错误状态')
      await load(offset)
    } catch (e) {
      message.error(formatErrorMessage(e))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await adminCredentialsApi.delete(deleteTarget.id)
      message.success('账号已删除')
      setDeleteTarget(null)
      await load(offset)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  // Non-admin guard
  if (user && user.role !== 'ADMIN') {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">仅管理员可访问 AI Provider 管理</p>
      </div>
    )
  }

  const columns: TableProps<AdminAccountRow>['columns'] = [
    {
      title: '账号名称',
      key: 'name',
      width: 160,
      fixed: 'left' as const,
      render: (_, r) => (
        <div>
          <div className="font-medium text-gray-900 text-sm">
            {r.name || `账号 #${r.id.slice(0, 8)}`}
          </div>
          {r.remark && (
            <Tooltip title={r.remark}>
              <div className="text-xs text-gray-400 truncate max-w-[140px]">
                {r.remark}
              </div>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Provider',
      key: 'provider',
      width: 100,
      render: (_, r) => (
        <Tag color="blue">{r.providerName}</Tag>
      ),
    },
    {
      title: 'Base URL',
      key: 'baseUrl',
      width: 200,
      render: (_, r) => (
        <Tooltip title={r.providerBaseUrl}>
          <span className="text-xs text-gray-600 truncate max-w-[160px] inline-block align-bottom">
            {r.providerBaseUrl.length > 28 ? `${r.providerBaseUrl.slice(0, 28)}...` : r.providerBaseUrl}
          </span>
        </Tooltip>
      ),
    },
    {
      title: 'API Key',
      key: 'apiKey',
      width: 140,
      render: (_, r) => (
        <span className="text-xs font-mono text-gray-600">
          {r.maskedApiKey || '—'}
        </span>
      ),
    },
    {
      title: '健康状态',
      dataIndex: 'status',
      key: 'healthStatus',
      width: 90,
      render: (status: string) => <HealthStatusBadge status={status} />,
    },
    {
      title: '启用',
      key: 'enabled',
      width: 70,
      render: (_, r) => (
        <Switch
          checked={r.status !== 'DISABLED'}
          loading={busyId === r.id}
          disabled={busyId === r.id}
          onChange={() => void handleToggleEnabled(r)}
          size="small"
        />
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 70,
      render: (v: number) => <span className="text-xs text-gray-600">{v}</span>,
    },
    {
      title: '权重',
      dataIndex: 'weight',
      key: 'weight',
      width: 60,
      render: (v: number) => <span className="text-xs text-gray-600">{v}</span>,
    },
    {
      title: '并发',
      key: 'concurrency',
      width: 80,
      render: (_, r) => (
        <span className="text-xs text-gray-600">
          {r.currentConcurrency} / {r.maxConcurrency}
        </span>
      ),
    },
    {
      title: '最近使用',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 100,
      render: (v: string | null) => (
        <span className="text-xs text-gray-500">{friendlyTime(v)}</span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
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
                  key: 'test',
                  label: '测试连接',
                  icon: <ApiOutlined />,
                  onClick: () => handleTestConnectionById(r),
                },
                ...(r.status === 'COOLDOWN' || r.status === 'ERROR' || r.lastError
                  ? [{
                      key: 'clearBackoff',
                      label: '清除错误/冷却状态',
                      onClick: () => void handleClearBackoff(r),
                    }]
                  : []),
                { type: 'divider' as const },
                {
                  key: 'delete',
                  label: '删除账号',
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
          管理各 AI 服务账号、API Key、状态及调度配置
        </p>
      </div>

      {/* Toolbar */}
      <div className="px-8 py-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-[260px]"
          placeholder="搜索账号名称、Provider、Base URL..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={() => { setSearch(searchInput); void load(0) }}
          allowClear
          onClear={() => { setSearch(''); void load(0) }}
        />
        <Select
          className="w-[140px]"
          placeholder="全部状态"
          value={statusFilter || undefined}
          onChange={(v) => { setStatusFilter(v ?? ''); void load(0) }}
          allowClear
          options={[
            { value: 'ACTIVE', label: '正常' },
            { value: 'COOLDOWN', label: '冷却中' },
            { value: 'ERROR', label: '异常' },
            { value: 'DISABLED', label: '已禁用' },
          ]}
        />
        <Select
          className="w-[140px]"
          placeholder="全部 Provider"
          value={providerFilter || undefined}
          onChange={(v) => { setProviderFilter(v ?? ''); void load(0) }}
          allowClear
          options={providers.map((p) => ({
            value: p.code,
            label: p.name,
          }))}
        />
        <div className="flex-1" />
        <Button
          icon={<SettingOutlined />}
          onClick={() => setProviderConfigOpen(true)}
        >
          渠道配置
        </Button>
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
          {loading && accounts.length === 0 ? (
            <div className="p-6">
              <Skeleton active paragraph={{ rows: 5 }} />
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-100 text-sm text-gray-500">
                共 {total} 个账号
              </div>
              <Table<AdminAccountRow>
                rowKey="id"
                columns={columns}
                dataSource={filtered}
                loading={loading}
                pagination={false}
                size="middle"
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: '暂无 AI 账号，点击「添加账号」创建' }}
              />
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  第 {offset + 1} - {offset + filtered.length} 条（共 {total} 条）
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
                    disabled={offset + defaultPageSize >= total || loading}
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

      {/* Account Form Modal */}
      <AccountFormModal
        open={formOpen}
        mode={formMode}
        account={editTarget}
        providers={providers}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmitAccount}
        submitting={submitting}
        onTestConnection={handleTestConnection}
        testing={testing}
        testResult={testResult}
      />

      {/* Provider Config Drawer */}
      <ProviderConfigDrawer
        open={providerConfigOpen}
        onClose={() => setProviderConfigOpen(false)}
        onChanged={() => void loadProviders()}
      />

      {/* Delete Account Modal */}
      <DeleteAccountModal
        open={!!deleteTarget}
        account={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        deleting={deleting}
      />
    </div>
  )
}
