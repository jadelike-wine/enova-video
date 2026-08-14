'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { authApi, setupApi, turnstileApi, type TurnstileConfig } from '../../../lib/api'
import { BRAND } from '../../../lib/brand'
import { formatErrorMessage } from '../../../lib/errorMessage'
import TurnstileWidget, { type TurnstileHandle } from '../../../components/auth/TurnstileWidget'
import LoginAgreementGate, { type LoginAgreementGateState } from '../../../components/auth/LoginAgreementGate'

export default function RegisterPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
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
      setError(t('agreeFirst'))
      return
    }
    if (password.length < 8) {
      setError(t('passwordTooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('passwordMismatch'))
      return
    }
    if (turnstile.enabled && !turnstileToken) {
      setError(t('completeCaptcha'))
      return
    }
    setBusy(true)
    try {
      await authApi.register(email, password, turnstile.enabled ? turnstileToken : undefined, agreement.revision)
      router.replace('/app/images')
      router.refresh()
    } catch (err) {
      setError(formatErrorMessage(err) || t('registerFailed'))
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
        <h1 className="text-2xl font-extrabold">{t('registerTitle')}</h1>
        <p className="text-sm text-white/50 mt-1">{t('registerSubtitle')}</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-white/70 mb-1.5">{t('email')}</label>
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
          <label className="block text-sm text-white/70 mb-1.5">{t('password')}</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordMinLength')}
          />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1.5">{t('confirmPassword')}</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            className="input-field"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t('passwordPlaceholder')}
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

        {error && <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-xl px-3 py-2">{error}</p>}

        <button type="submit" disabled={busy || !agreement.ready || (agreement.enabled && !agreement.accepted)} className="btn-primary w-full">
          {busy ? t('registering') : t('register')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/50">
        {t('hasAccount')}{' '}
        <Link href="/auth/login" className="text-cyan-300 hover:underline">
          {t('goLogin')}
        </Link>
      </p>
    </div>
  )
}
