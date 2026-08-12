'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authApi, setupApi, turnstileApi, type TurnstileConfig } from '../../../lib/api'
import { BRAND } from '../../../lib/brand'
import { formatErrorMessage } from '../../../lib/errorMessage'
import TurnstileWidget, { type TurnstileHandle } from '../../../components/auth/TurnstileWidget'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [turnstile, setTurnstile] = useState<TurnstileConfig>({ enabled: false, siteKey: '' })
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileRef = useRef<TurnstileHandle>(null)

  useEffect(() => {
    let active = true
    turnstileApi
      .config()
      .then((cfg) => {
        if (active) setTurnstile(cfg)
      })
      .catch(() => {
        /* 容错：配置获取失败则静默跳过验证码 */
      })
    return () => {
      active = false
    }
  }, [])

  // 首启：系统尚无管理员时跳转到初始化向导
  useEffect(() => {
    let active = true
    setupApi
      .status()
      .then((s) => {
        if (active && s.needsSetup) router.replace('/setup')
      })
      .catch(() => {
        /* 容错：探测失败不阻塞提交 */
      })
    return () => {
      active = false
    }
  }, [router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (turnstile.enabled && !turnstileToken) {
      setError('请先完成安全验证')
      return
    }
    setBusy(true)
    try {
      await authApi.login(email, password, turnstile.enabled ? turnstileToken : undefined)
      router.replace('/app/chat')
      router.refresh()
    } catch (err) {
      setError(formatErrorMessage(err) || '登录失败')
      turnstileRef.current?.reset()
      setTurnstileToken('')
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
        <h1 className="text-2xl font-extrabold">登录 {BRAND.nameZh}</h1>
        <p className="text-sm text-white/50 mt-1">继续你的 AI 创作之旅</p>
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
            autoComplete="current-password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {turnstile.enabled && turnstile.siteKey && (
          <div>
            <TurnstileWidget
              ref={turnstileRef}
              siteKey={turnstile.siteKey}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken('')}
            />
          </div>
        )}

        {error && <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-xl px-3 py-2">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? '登录中…' : '登录'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/50">
        还没有账号？{' '}
        <Link href="/auth/register" className="text-cyan-300 hover:underline">
          立即注册
        </Link>
      </p>
    </div>
  )
}
