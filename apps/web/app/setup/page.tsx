'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setupApi } from '../../lib/api'
import { BRAND } from '../../lib/brand'
import { formatErrorMessage } from '../../lib/errorMessage'

/**
 * 首启 Setup 向导：当系统尚无管理员账号时，引导访问者创建首个管理员。
 * 若系统已初始化，自动跳转到登录页。
 */
export default function SetupPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setupApi
      .status()
      .then((s) => {
        if (!active) return
        if (!s.needsSetup) {
          router.replace('/auth/login')
        } else {
          setChecking(false)
        }
      })
      .catch(() => {
        // 探测失败兜底：仍展示向导，避免空屏
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [router])

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
      await setupApi.init(email, password)
      router.replace('/app/chat')
      router.refresh()
    } catch (err) {
      setError(formatErrorMessage(err) || '创建管理员失败')
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="glass-card p-8 text-center text-gray-500">
        正在检查系统状态…
      </div>
    )
  }

  return (
    <div className="glass-card p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center text-2xl font-extrabold text-white mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-bold">初始化 {BRAND.nameZh}</h1>
        <p className="text-sm text-gray-500 mt-1">创建首个管理员账号（仅此一次）</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1.5">管理员邮箱</label>
          <input
            type="email"
            required
            autoComplete="email"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1.5">管理员密码</label>
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
          <label className="block text-sm text-gray-700 mb-1.5">确认密码</label>
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

        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? '创建中…' : '创建管理员'}
        </button>
      </form>
    </div>
  )
}