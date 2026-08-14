'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { setupApi } from '../../lib/api'
import { BRAND } from '../../lib/brand'
import { formatErrorMessage } from '../../lib/errorMessage'

/**
 * 首启 Setup 向导：当系统尚无管理员账号时，引导访问者创建首个管理员。
 * 若系统已初始化，自动跳转到登录页。
 */
export default function SetupPage() {
  const t = useTranslations('setup')
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
      setError(t('passwordTooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('passwordMismatch'))
      return
    }
    setBusy(true)
    try {
      await setupApi.init(email, password)
      router.replace('/app/images')
      router.refresh()
    } catch (err) {
      setError(formatErrorMessage(err) || t('createFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="glass-card p-8 text-center text-gray-500">
        {t('checking')}
      </div>
    )
  }

  return (
    <div className="glass-card p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center text-2xl font-extrabold text-white mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1.5">{t('adminEmail')}</label>
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
          <label className="block text-sm text-gray-700 mb-1.5">{t('adminPassword')}</label>
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
          <label className="block text-sm text-gray-700 mb-1.5">{t('confirmPassword')}</label>
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

        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? t('creating') : t('create')}
        </button>
      </form>
    </div>
  )
}