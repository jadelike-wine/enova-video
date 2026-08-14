'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authApi, setupApi, turnstileApi, type TurnstileConfig } from '../../../lib/api'
import { BRAND } from '../../../lib/brand'
import { formatErrorMessage } from '../../../lib/errorMessage'
import TurnstileWidget, { type TurnstileHandle } from '../../../components/auth/TurnstileWidget'
import LoginAgreementGate, { type LoginAgreementGateState } from '../../../components/auth/LoginAgreementGate'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [turnstile, setTurnstile] = useState<TurnstileConfig>({ enabled: false, siteKey: '' })
  const [turnstileToken, setTurnstileToken] = useState('')
  const [agreement, setAgreement] = useState<LoginAgreementGateState>({
    ready: false,
    enabled: false,
    accepted: false,
    revision: '',
  })
  const turnstileRef = useRef<TurnstileHandle>(null)

  const handleAgreementStateChange = useCallback((state: LoginAgreementGateState) => {
    setAgreement(state)
  }, [])

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
    if (!agreement.ready || (agreement.enabled && !agreement.accepted)) {
      setError('请先阅读并同意登录条款')
      return
    }
    if (turnstile.enabled && !turnstileToken) {
      setError('请先完成安全验证')
      return
    }
    setBusy(true)
    try {
      await authApi.login(email, password, turnstile.enabled ? turnstileToken : undefined, agreement.revision)
      router.replace('/app/images')
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
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center text-2xl font-extrabold text-white mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-bold">登录 {BRAND.nameZh}</h1>
        <p className="text-sm text-gray-500 mt-1">继续你的 AI 创作之旅</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1.5">邮箱</label>
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
          <label className="block text-sm text-gray-700 mb-1.5">密码</label>
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

        <LoginAgreementGate onStateChange={handleAgreementStateChange} />

        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}

        <button type="submit" disabled={busy || !agreement.ready || (agreement.enabled && !agreement.accepted)} className="btn-primary w-full">
          {busy ? '登录中…' : '登录'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        还没有账号？{' '}
        <Link href="/auth/register" className="text-[#7C3AED] hover:underline">
          立即注册
        </Link>
      </p>
    </div>
  )
}
