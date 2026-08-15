'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Alert, Button, Spin } from 'antd'
import { authApi } from '@/lib/api'
import { BRAND } from '@/lib/brand'
import { formatErrorMessage } from '@/lib/errorMessage'

type Phase = 'verifying' | 'success' | 'error' | 'no-token'

export default function VerifyEmailPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [phase, setPhase] = useState<Phase>('verifying')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setPhase('no-token')
      return
    }

    let active = true
    ;(async () => {
      try {
        await authApi.verifyEmail(token)
        if (active) setPhase('success')
      } catch (err) {
        if (active) {
          setPhase('error')
          setMessage(formatErrorMessage(err) || t('verifyFailed'))
        }
      }
    })()

    return () => {
      active = false
    }
  }, [token, t])

  const goLogin = useCallback(() => {
    router.replace('/auth/login')
  }, [router])

  return (
    <div className="glass-card p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-2xl font-extrabold text-white mb-4">
          {BRAND.logoMarkZh}
        </div>
        <h1 className="text-2xl font-bold">{t('verifyEmailTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('verifyEmailSubtitle')}</p>
      </div>

      {phase === 'verifying' && (
        <div className="text-center py-8">
          <Spin size="large" />
          <p className="mt-4 text-sm text-gray-500">{t('verifying')}</p>
        </div>
      )}

      {phase === 'success' && (
        <div className="text-center">
          <Alert
            message={t('verifySuccessTitle')}
            description={t('verifySuccessMessage')}
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

      {phase === 'error' && (
        <div className="text-center">
          <Alert
            message={t('verifyFailedTitle')}
            description={message}
            type="error"
            showIcon
          />
          <div className="mt-6">
            <Button type="primary" onClick={goLogin}>
              {t('goLogin')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'no-token' && (
        <div className="text-center">
          <Alert
            message={t('verifyFailedTitle')}
            description={t('verifyTokenMissing')}
            type="warning"
            showIcon
          />
          <div className="mt-6">
            <Button type="primary" onClick={goLogin}>
              {t('goLogin')}
            </Button>
          </div>
        </div>
      )}

      {phase !== 'success' && (
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
