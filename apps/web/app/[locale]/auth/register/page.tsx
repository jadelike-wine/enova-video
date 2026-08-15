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

interface RegisterFormValues {
  email: string
  password: string
  confirm: string
  invitationCode?: string
  promoCode?: string
}

export default function RegisterPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const [form] = Form.useForm<RegisterFormValues>()
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

  const handleSubmit = async (values: RegisterFormValues) => {
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
      await authApi.register(
        values.email,
        values.password,
        turnstile.enabled ? turnstileToken : undefined,
        agreement.revision,
        authConfig?.requireInvitationCode ? values.invitationCode : undefined,
        authConfig?.enablePromoCode ? values.promoCode : undefined,
      )
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

  // 注册关闭时显示提示而非表单
  if (authConfig && !authConfig.openRegistration) {
    return (
      <div className="glass-card p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-2xl font-extrabold text-white mb-4">
            {BRAND.logoMarkZh}
          </div>
          <h1 className="text-2xl font-extrabold">{t('registerTitle')}</h1>
        </div>
        <Alert
          message={t('registrationDisabled')}
          description={t('registrationDisabledDescription')}
          type="warning"
          showIcon
        />
        <p className="mt-6 text-center text-sm text-gray-500">
          {t('hasAccount')}{' '}
          <Link href="/auth/login" className="text-[#0d9488] hover:underline">
            {t('goLogin')}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-2xl font-extrabold text-white mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-extrabold">{t('registerTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('registerSubtitle')}</p>
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
          rules={[
            { required: true, message: t('password') },
            { min: 8, message: t('passwordTooShort') },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={t('passwordMinLength')}
          />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t('confirmPassword')}
          dependencies={['password']}
          rules={[
            { required: true, message: t('confirmPassword') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error(t('passwordMismatch')))
              },
            }),
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={t('passwordPlaceholder')}
          />
        </Form.Item>

        {authConfig?.requireInvitationCode && (
          <Form.Item
            name="invitationCode"
            label={t('invitationCode')}
            rules={[{ required: true, message: t('invitationCodeRequired') }]}
          >
            <Input
              placeholder={t('invitationCodePlaceholder')}
              autoComplete="off"
            />
          </Form.Item>
        )}

        {authConfig?.enablePromoCode && (
          <Form.Item
            name="promoCode"
            label={t('promoCode')}
          >
            <Input
              placeholder={t('promoCodePlaceholder')}
              autoComplete="off"
            />
          </Form.Item>
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
            {busy ? t('registering') : t('register')}
          </Button>
        </Form.Item>
      </Form>

      <p className="mt-6 text-center text-sm text-gray-500">
        {t('hasAccount')}{' '}
        <Link href="/auth/login" className="text-[#0d9488] hover:underline">
          {t('goLogin')}
        </Link>
      </p>
    </div>
  )
}
