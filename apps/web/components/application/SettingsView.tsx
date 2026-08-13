'use client'

import Link from 'next/link'
import { useSession } from '../../lib/auth'
import { BRAND } from '../../lib/brand'

const ROLE_LABEL: Record<string, string> = {
  USER: '普通用户',
  ADMIN: '管理员',
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '正常',
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email || '—'
  const [name, domain] = email.split('@')
  const visible = name.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`
}

export default function SettingsView() {
  const { user, balance, reservedBalance, logout } = useSession()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-gray-200">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
          账户设置
        </h2>
        <p className="text-sm text-gray-500 mt-1">查看账户信息与余额，管理登录状态</p>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {/* 账户信息 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-4">账户信息</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">邮箱</p>
              <p className="text-gray-800 font-medium break-all">{user ? maskEmail(user.email) : '—'}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">角色</p>
              <p className="text-gray-800 font-medium">
                {user ? ROLE_LABEL[user.role] || user.role : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">账户状态</p>
              <p className="text-gray-800 font-medium">
                {user ? STATUS_LABEL[user.status] || user.status : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">工作区</p>
              <p className="text-gray-800 font-mono text-sm">
                {user ? user.workspaceId.slice(0, 8) : '—'}
              </p>
            </div>
          </div>
        </section>

        {/* 余额概览 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">余额</h3>
            <Link href="/app/wallet" className="btn-secondary text-sm">
              前往钱包充值
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">可用余额</p>
              <p className="text-3xl font-extrabold text-cyan-600">
                {balance.toLocaleString()}
                <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">已预留</p>
              <p className="text-3xl font-extrabold text-amber-600">
                {reservedBalance.toLocaleString()}
                <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">总余额</p>
              <p className="text-3xl font-extrabold text-gray-900">
                {(balance + reservedBalance).toLocaleString()}
                <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
              </p>
            </div>
          </div>
        </section>

        {/* 平台说明 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-3">关于本平台</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li>
              • Provider 凭据与对象存储由平台统一托管，无需个人配置。
            </li>
            <li>
              • 生成任务统一按「预留 → 结算 / 释放」计费，失败任务自动退还 Credits。
            </li>
            <li>
              • 充值订单与余额流水可在「钱包」页查看。
            </li>
          </ul>
          <p className="text-xs text-gray-400 mt-4">
            {BRAND.nameZh} ({BRAND.name}) · {BRAND.taglineZh}
          </p>
        </section>

        {/* 退出登录 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-2">登录状态</h3>
          <p className="text-sm text-gray-500 mb-4">退出后需要重新登录才能访问创作功能。</p>
          <button onClick={() => void logout()} className="btn-ghost text-rose-600 hover:text-rose-700">
            退出登录
          </button>
        </section>
      </div>
    </div>
  )
}