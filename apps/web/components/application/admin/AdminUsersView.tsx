'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Form, Input, InputNumber, Modal, Space, Table, Tag } from 'antd'
import type { TableProps } from 'antd'
import { adminUsersApi, type AdminUserView } from '../../../lib/adminApi'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { AdminLink, Card, PageHeader, fmtDate } from './AdminUi'

const PAGE_SIZE = 50

interface AdjustCreditsFormValues {
  delta: number
  reason?: string
}

export default function AdminUsersView() {
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<AdjustCreditsFormValues>()
  const [users, setUsers] = useState<AdminUserView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // 调整 Credits 弹窗状态
  const [adjustTarget, setAdjustTarget] = useState<AdminUserView | null>(null)
  const [adjusting, setAdjusting] = useState(false)

  const load = useCallback(
    async (off: number) => {
      setLoading(true)
      try {
        const rows = await adminUsersApi.list({ limit: PAGE_SIZE, offset: off })
        setUsers(rows)
        setOffset(off)
      } catch (e) {
        message.error(formatErrorMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    void load(0)
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.email.toLowerCase().includes(q) || u.workspaceId === q)
  }, [users, search])

  const toggleStatus = async (u: AdminUserView) => {
    const target = u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      await modal.confirm({
        title: `${target === 'ACTIVE' ? '启用' : '禁用'}用户`,
        content: `确定要${target === 'ACTIVE' ? '启用' : '禁用'} ${u.email} 吗？`,
        okText: '确定',
        cancelText: '取消',
        okButtonProps: { danger: target === 'DISABLED' },
        onOk: async () => {
          setBusyId(u.id)
          try {
            await adminUsersApi.setStatus(u.id, target)
            await load(offset)
            message.success(`用户状态已改为 ${target === 'ACTIVE' ? '启用' : '禁用'}`)
          } catch (e) {
            message.error(formatErrorMessage(e))
          } finally {
            setBusyId(null)
          }
        },
      })
    } catch {
      /* 用户取消 */
    }
  }

  const openAdjust = (u: AdminUserView) => {
    setAdjustTarget(u)
    form.resetFields()
    form.setFieldsValue({ delta: 0, reason: '' })
  }

  const submitAdjust = async (values: AdjustCreditsFormValues) => {
    if (!adjustTarget) return
    const n = values.delta
    if (!Number.isInteger(n) || n === 0) {
      message.warning('请输入非零整数 Credits')
      return
    }
    setAdjusting(true)
    try {
      await adminUsersApi.adjustCredits(adjustTarget.id, n, values.reason || 'Admin credits adjustment')
      setAdjustTarget(null)
      await load(offset)
      message.success(`已调整 ${n} Credits`)
    } catch (e) {
      message.error(formatErrorMessage(e))
    } finally {
      setAdjusting(false)
    }
  }

  const columns: TableProps<AdminUserView>['columns'] = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (email: string, u) => (
        <AdminLink href={`/app/admin/customers/${u.id}`}>{email}</AdminLink>
      ),
    },
    { title: '角色', dataIndex: 'role', key: 'role', render: (v: string) => <span className="text-gray-500">{v}</span> },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'ACTIVE' ? 'success' : 'default'}>{status === 'ACTIVE' ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '工作空间',
      dataIndex: 'workspaceId',
      key: 'workspaceId',
      render: (v?: string) => <span className="text-gray-500">{v?.slice(0, 8) ?? '—'}</span>,
    },
    { title: '可用', dataIndex: 'balance', key: 'balance', render: (v: number) => <span className="text-cyan-600">{v}</span> },
    { title: '预留', dataIndex: 'reservedBalance', key: 'reservedBalance', render: (v: number) => <span className="text-gray-500">{v}</span> },
    { title: '注册时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => <span className="text-gray-500">{fmtDate(v)}</span> },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, u) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            loading={busyId === u.id}
            onClick={() => void toggleStatus(u)}
          >
            {u.status === 'ACTIVE' ? '禁用' : '启用'}
          </Button>
          <Button type="link" size="small" disabled={busyId === u.id} onClick={() => openAdjust(u)}>
            调 Credits
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="用户管理" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Input
            className="max-w-xs"
            placeholder="搜索邮箱 / 工作空间 ID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={() => setSearch(searchInput)}
            allowClear
          />
          <Button type="primary" onClick={() => setSearch(searchInput)}>
            搜索
          </Button>
          <Button
            onClick={() => {
              setSearch('')
              setSearchInput('')
            }}
          >
            清空
          </Button>
        </div>

        <Card>
          <Table<AdminUserView>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            loading={loading}
            pagination={false}
            size="middle"
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: '没有匹配的用户' }}
          />
          <div className="flex items-center justify-between pt-4">
            <Button size="small" disabled={offset === 0 || loading} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>
              上一页
            </Button>
            <span className="text-xs text-gray-400">
              第 {offset + 1} - {offset + filtered.length} 条
            </span>
            <Button size="small" disabled={users.length < PAGE_SIZE || loading} onClick={() => void load(offset + PAGE_SIZE)}>
              下一页
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        title={`调整 Credits — ${adjustTarget?.email ?? ''}`}
        open={!!adjustTarget}
        onCancel={() => setAdjustTarget(null)}
        onOk={() => form.submit()}
        okText="确认调整"
        cancelText="取消"
        confirmLoading={adjusting}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={submitAdjust}
          initialValues={{ delta: 0, reason: '' }}
        >
          <Form.Item
            name="delta"
            label="调整数量（正数增加，负数扣减）"
            rules={[
              { required: true, message: '请输入调整数量' },
              {
                validator: async (_, value) => {
                  if (!Number.isInteger(value) || value === 0) {
                    throw new Error('请输入非零整数 Credits')
                  }
                },
              },
            ]}
          >
            <InputNumber className="w-full" placeholder="例：100 或 -50" />
          </Form.Item>
          <Form.Item
            name="reason"
            label="调整原因（将写入审计日志）"
          >
            <Input placeholder="请输入调整原因" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
