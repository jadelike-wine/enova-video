'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Alert, Button, Form, Input } from 'antd'
import { authApi } from '@/lib/api'
import { BRAND } from '@/lib/brand'
import { formatErrorMessage } from '@/lib/errorMessage'

interface ForgotPasswordFormValues {
  email: string
}

export default function ForgotPasswordPage() {
  const t = useTranslations('auth')
  const [form] = Form.useForm<ForgotPasswordFormValues>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (values: ForgotPasswordFormValues) => {
    setBusy(true)
    setError('')
    try {
      await authApi.forgotPassword(values.email)
      setSent(true)
    } catch (err) {
      setError(formatErrorMessage(err) || t('forgotPasswordFailed'))
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
        <h1 className="text-2xl font-bold">{t('forgotPasswordTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('forgotPasswordSubtitle')}</p>
      </div>

      {sent ? (
        <div className="space-y-6">
          <Alert
            message={t('forgotPasswordSent')}
            description={t('forgotPasswordSentDescription')}
            type="success"
            showIcon
          />
          <Link href="/auth/login" className="block text-center text-sm text-[#0d9488] hover:underline">
            {t('backToLogin')}
          </Link>
        </div>
      ) : (
        <Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="on">
          <Form.Item
            name="email"
            label={t('email')}
            rules={[
              { required: true, message: t('email') },
              { type: 'email', message: t('emailInvalid') },
            ]}
          >
            <Input type="email" autoComplete="email" placeholder="you@example.com" />
          </Form.Item>

          {error && (
            <div className="mb-4">
              <Alert message={error} type="error" showIcon />
            </div>
          )}

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              {busy ? t('sending') : t('sendResetEmail')}
            </Button>
          </Form.Item>
        </Form>
      )}

      <p className="mt-6 text-center text-sm text-gray-500">
        <Link href="/auth/login" className="text-[#0d9488] hover:underline">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  )
}
