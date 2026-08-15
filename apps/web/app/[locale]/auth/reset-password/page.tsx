'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Alert, Button, Form, Input } from 'antd'
import { authApi } from '@/lib/api'
import { BRAND } from '@/lib/brand'
import { formatErrorMessage } from '@/lib/errorMessage'

interface ResetFormValues {
  newPassword: string
  confirm: string
}

type Phase = 'request' | 'reset' | 'done'

export default function ResetPasswordPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [requestForm] = Form.useForm<{ email: string }>()
  const [resetForm] = Form.useForm<ResetFormValues>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('request')

  // 从 URL query 读取 token，有 token 则直接进入重置阶段
  const token = searchParams.get('token')

  useEffect(() => {
    if (token) setPhase('reset')
  }, [token])

  const handleRequest = async (values: { email: string }) => {
    setBusy(true)
    setError('')
    try {
      await authApi.forgotPassword(values.email)
      setPhase('done')
    } catch (err) {
      setError(formatErrorMessage(err) || t('resetFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleReset = async (values: ResetFormValues) => {
    if (!token) {
      setError(t('resetTokenMissing'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await authApi.resetPassword(token, values.newPassword)
      setPhase('done')
    } catch (err) {
      setError(formatErrorMessage(err) || t('resetFailed'))
    } finally {
      setBusy(false)
    }
  }

  const goLogin = useCallback(() => {
    router.replace('/auth/login')
  }, [router])

  return (
    <div className="glass-card p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-2xl font-extrabold text-white mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-bold">{t('resetPasswordTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('resetPasswordSubtitle')}</p>
      </div>

      {phase === 'request' && (
        <Form
          form={requestForm}
          layout="vertical"
          onFinish={handleRequest}
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
            >
              {busy ? t('sending') : t('sendResetLink')}
            </Button>
          </Form.Item>
        </Form>
      )}

      {phase === 'reset' && token && (
        <Form
          form={resetForm}
          layout="vertical"
          onFinish={handleReset}
          autoComplete="on"
        >
          <Form.Item
            name="newPassword"
            label={t('newPassword')}
            rules={[
              { required: true, message: t('newPassword') },
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
            dependencies={['newPassword']}
            rules={[
              { required: true, message: t('confirmPassword') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
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
            >
              {busy ? t('resetting') : t('resetPassword')}
            </Button>
          </Form.Item>
        </Form>
      )}

      {phase === 'done' && (
        <div className="text-center">
          <Alert
            message={t('resetDoneTitle')}
            description={t('resetDoneMessage')}
            type="success"
            showIcon
          />
          <div className="mt-6">
            <Button type="primary" onClick={goLogin}>
              {t('goLogin')}
            </Button>
          </div>
        </div>
      )}

      {phase !== 'done' && (
        <p className="mt-6 text-center text-sm text-gray-500">
          {t('hasAccount')}{' '}
          <Link href="/auth/login" className="text-[#0d9488] hover:underline">
            {t('goLogin')}
          </Link>
        </p>
      )}
    </div>
  )
}
