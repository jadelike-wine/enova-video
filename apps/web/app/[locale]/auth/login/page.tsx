'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Alert, Button, Form, Input } from 'antd'
import { authApi, publicApi, setupApi, turnstileApi, type AuthConfig, type TurnstileConfig } from '@/lib/api'
import { BRAND } from '@/lib/brand'
import { formatErrorMessage } from '@/lib/errorMessage'
import TurnstileWidget, { type TurnstileHandle } from '@/components/auth/TurnstileWidget'
import LoginAgreementGate, { type LoginAgreementGateState } from '@/components/auth/LoginAgreementGate'

interface LoginFormValues {
  email: string
  password: string
}

export default function LoginPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const [form] = Form.useForm<LoginFormValues>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [turnstile, setTurnstile] = useState<TurnstileConfig>({ enabled: false, siteKey: '' })
  const [turnstileToken, setTurnstileToken] = useState('')
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
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
    publicApi
      .authConfig()
      .then((cfg) => {
        if (active) setAuthConfig(cfg)
      })
      .catch(() => {
        /* 容错 */
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

  const handleSubmit = async (values: LoginFormValues) => {
    if (!agreement.ready || (agreement.enabled && !agreement.accepted)) {
      setError(t('agreeFirst'))
      return
    }
    if (turnstile.enabled && !turnstileToken) {
      setError(t('completeCaptcha'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await authApi.login(values.email, values.password, turnstile.enabled ? turnstileToken : undefined, agreement.revision)
      router.replace('/app/images')
      router.refresh()
    } catch (err) {
      setError(formatErrorMessage(err) || t('loginFailed'))
      turnstileRef.current?.reset()
      setTurnstileToken('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass-card p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-2xl font-extrabold text-white mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-bold">{t('loginTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('loginSubtitle')}</p>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        autoComplete="on"
      >
        <Form.Item
          name="email"
          label={t('email')}
          rules={[{ required: true, message: t('email') }]}
        >
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('password')}
          rules={[{ required: true, message: t('password') }]}
        >
          <Input.Password
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </Form.Item>

        {authConfig?.enablePasswordReset && (
          <div className="flex justify-end mb-4">
            <Link href="/auth/forgot-password" className="text-xs text-[#0d9488] hover:underline">
              {t('forgotPassword')}
            </Link>
          </div>
        )}

        {turnstile.enabled && turnstile.siteKey && (
          <Form.Item>
            <TurnstileWidget
              ref={turnstileRef}
              siteKey={turnstile.siteKey}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken('')}
            />
          </Form.Item>
        )}

        <LoginAgreementGate onStateChange={handleAgreementStateChange} />

        {error && (
          <div className="mb-4">
            <Alert message={error} type="error" showIcon />
          </div>
        )}

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={busy}
            disabled={!agreement.ready || (agreement.enabled && !agreement.accepted)}
          >
            {busy ? t('loggingIn') : t('login')}
          </Button>
        </Form.Item>
      </Form>

      <p className="mt-6 text-center text-sm text-gray-500">
        {t('noAccount')}{' '}
        <Link href="/auth/register" className="text-[#0d9488] hover:underline">
          {t('registerNow')}
        </Link>
      </p>
    </div>
  )
}
