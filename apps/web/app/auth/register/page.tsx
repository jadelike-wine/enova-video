'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authApi } from '../../../lib/api'
import { BRAND } from '../../../lib/brand'
import { formatErrorMessage } from '../../../lib/errorMessage'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      await authApi.register(email, password)
      router.replace('/app/chat')
      router.refresh()
    } catch (err) {
      setError(formatErrorMessage(err) || '注册失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass-card p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 flex items-center justify-center text-2xl font-extrabold shadow-glow mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-extrabold">注册 {BRAND.nameZh}</h1>
        <p className="text-sm text-white/50 mt-1">创建账号，立即开始创作</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-white/70 mb-1.5">邮箱</label>
          <input
            type="email"
            required
            autoComplete="email"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1.5">密码</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 位"
          />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1.5">确认密码</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            className="input-field"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="再次输入密码"
          />
        </div>

        {error && <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-xl px-3 py-2">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? '注册中…' : '注册'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/50">
        已有账号？{' '}
        <Link href="/auth/login" className="text-cyan-300 hover:underline">
          去登录
        </Link>
      </p>
    </div>
  )
}