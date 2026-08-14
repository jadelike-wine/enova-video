'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Alert, Button, Form, Input } from 'antd'
import { setupApi } from '@/lib/api'
import { BRAND } from '@/lib/brand'
import { formatErrorMessage } from '@/lib/errorMessage'

interface SetupFormValues {
  email: string
  password: string
  confirm: string
}

/**
 * 首启 Setup 向导：当系统尚无管理员账号时，引导访问者创建首个管理员。
 * 若系统已初始化，自动跳转到登录页。
 */
export default function SetupPage() {
  const t = useTranslations('setup')
  const router = useRouter()
  const [form] = Form.useForm<SetupFormValues>()
  const [checking, setChecking] = useState(true)
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

  const handleSubmit = async (values: SetupFormValues) => {
    setBusy(true)
    setError('')
    try {
      await setupApi.init(values.email, values.password)
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

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        autoComplete="on"
      >
        <Form.Item
          name="email"
          label={t('adminEmail')}
          rules={[{ required: true, message: t('adminEmail') }]}
        >
          <Input
            type="email"
            autoComplete="email"
            placeholder="admin@example.com"
          />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('adminPassword')}
          rules={[
            { required: true, message: t('adminPassword') },
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
            {busy ? t('creating') : t('create')}
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}
