'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminUsersApi, type AdminUserView } from '../../../lib/adminApi'
import { useDialog } from '../DialogProvider'
import { formatErrorMessage } from '../../../lib/errorMessage'
import { AdminLink, Card, DataTable, EmptyState, Loading, PageHeader, StatusBadge, fmtDate } from './AdminUi'

const PAGE_SIZE = 50

export default function AdminUsersView() {
  const { alert, confirm } = useDialog()
  const [users, setUsers] = useState<AdminUserView[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(
    async (off: number) => {
      setLoading(true)
      try {
        const rows = await adminUsersApi.list({ limit: PAGE_SIZE, offset: off })
        setUsers(rows)
        setOffset(off)
      } catch (e) {
        await alert({ title: '加载失败', message: formatErrorMessage(e) })
      } finally {
        setLoading(false)
      }
    },
    [alert],
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
    const ok = await confirm({
      title: `${target === 'ACTIVE' ? '启用' : '禁用'}用户`,
      message: `确定要${target === 'ACTIVE' ? '启用' : '禁用'} ${u.email} 吗？`,
      confirmVariant: target === 'DISABLED' ? 'danger' : 'primary',
    })
    if (!ok) return
    setBusyId(u.id)
    try {
      await adminUsersApi.setStatus(u.id, target)
      await load(offset)
      await alert({ title: '已更新', message: `用户状态已改为 ${target}` })
    } catch (e) {
      await alert({ title: '操作失败', message: formatErrorMessage(e) })
    } finally {
      setBusyId(null)
    }
  }

  const adjustCredits = async (u: AdminUserView) => {
    const delta = window.prompt(`为 ${u.email} 调整 Credits（正数增加，负数扣减）：`, '0')
    if (delta === null) return
    const n = Number(delta)
    if (!Number.isInteger(n) || n === 0) {
      await alert({ title: '无效输入', message: '请输入非零整数 Credits' })
      return
    }
    const reason = window.prompt('请输入调整原因（将写入审计日志）：', '')
    if (reason === null) return
    setBusyId(u.id)
    try {
      await adminUsersApi.adjustCredits(u.id, n, reason || 'Admin credits adjustment')
      await load(offset)
      await alert({ title: '已调整', message: `已调整 ${n} Credits` })
    } catch (e) {
      await alert({ title: '调整失败', message: formatErrorMessage(e) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="用户管理" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <input
            className="input-field max-w-xs"
            placeholder="搜索邮箱 / Workspace ID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(searchInput)
            }}
          />
          <button className="btn-secondary" onClick={() => setSearch(searchInput)}>
            搜索
          </button>
          <button className="btn-ghost" onClick={() => { setSearch(''); setSearchInput('') }}>
            清空
          </button>
        </div>

        <Card>
          {loading ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <EmptyState text="没有匹配的用户" />
          ) : (
            <DataTable
              headers={['邮箱', '角色', '状态', 'Workspace', '可用', '预留', '注册时间', '操作']}
            >
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-gray-100">
                  <td className="px-3 py-2">
                    <AdminLink href={`/app/admin/customers/${u.id}`}>{u.email}</AdminLink>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{u.role}</td>
                  <td className="px-3 py-2"><StatusBadge status={u.status} /></td>
                  <td className="px-3 py-2 text-gray-600">{u.workspaceId?.slice(0, 8) ?? '—'}</td>
                  <td className="px-3 py-2 text-cyan-600">{u.balance}</td>
                  <td className="px-3 py-2 text-gray-600">{u.reservedBalance}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtDate(u.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button className="btn-ghost text-xs mr-2" disabled={busyId === u.id} onClick={() => void toggleStatus(u)}>
                      {u.status === 'ACTIVE' ? '禁用' : '启用'}
                    </button>
                    <button className="btn-ghost text-xs" disabled={busyId === u.id} onClick={() => void adjustCredits(u)}>
                      调 Credits
                    </button>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <div className="flex items-center justify-between pt-3">
            <button className="btn-ghost text-xs" disabled={offset === 0 || loading} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>
              上一页
            </button>
            <span className="text-xs text-gray-400">offset {offset}</span>
            <button className="btn-ghost text-xs" disabled={users.length < PAGE_SIZE || loading} onClick={() => void load(offset + PAGE_SIZE)}>
              下一页
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}