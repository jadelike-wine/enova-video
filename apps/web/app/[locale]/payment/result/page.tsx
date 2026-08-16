'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, Result, Spin } from 'antd'
import { useTranslations } from 'next-intl'
import { paymentApi, authApi, type OrderStatus } from '../../../../lib/api'

/**
 * 支付返回页（return URL）。
 *
 * P2 修复：支付宝/微信支付完成后跳转到此页面，通过 orderId 轮询订单状态。
 * - 时序 B（return 先到，notify 后到）：页面轮询直到 SUCCEEDED。
 * - 时序 A（notify 先到）：页面立即显示成功。
 *
 * returnUrl 格式：{returnBaseUrl}/payment/result?orderId={orderId}
 */
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120_000 // 2 分钟超时

export default function PaymentResultPage() {
  const t = useTranslations('paymentResult')
  // 支付成功后刷新后端 session（用户余额）。
  // 本页面不在 SessionProvider 内（独立支付返回路由），
  // 用户跳转到 /app/* 时 AppShell 会自动重新获取最新 session。
  const refreshSession = useCallback(async () => {
    try {
      await authApi.me()
    } catch {
      // 忽略：用户跳转后 AppShell 会自动重试
    }
  }, [])

  // 从 URL query string 获取 orderId。
  const [orderId, setOrderId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'failed' | 'error'>('loading')
  const [orderInfo, setOrderInfo] = useState<OrderStatus | null>(null)
  const startTimeRef = useRef(Date.now())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 初始化：从 URL 读取 orderId
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const id = params.get('orderId')
    if (id) {
      setOrderId(id)
    } else {
      // 尝试从 sessionStorage 读取（用户可能直接被跳转回来）
      const pending = sessionStorage.getItem('pendingPaymentOrderId')
      if (pending) {
        setOrderId(pending)
      } else {
        setStatus('error')
      }
    }
  }, [])

  const pollOrderStatus = useCallback(async (id: string) => {
    try {
      const result = await paymentApi.getOrderStatus(id)
      setOrderInfo(result)

      if (result.status === 'SUCCEEDED') {
        setStatus('success')
        sessionStorage.removeItem('pendingPaymentOrderId')
        await refreshSession()
        // 停止轮询
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } else if (result.status === 'FAILED' || result.status === 'CANCELED') {
        setStatus('failed')
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } else {
        setStatus('pending')
        // 检查是否超时
        if (Date.now() - startTimeRef.current > POLL_TIMEOUT_MS) {
          setStatus('error')
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        }
      }
    } catch {
      setStatus('error')
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [refreshSession])

  // 开始轮询
  useEffect(() => {
    if (!orderId) return

    startTimeRef.current = Date.now()
    // 立即查询一次
    void pollOrderStatus(orderId)
    // 设置轮询
    pollRef.current = setInterval(() => {
      void pollOrderStatus(orderId)
    }, POLL_INTERVAL_MS)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [orderId, pollOrderStatus])

  if (!orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Result
          status="warning"
          title={t('missingOrderId')}
          extra={
            <Link href="/app/wallet">
              <Button type="primary">{t('goToWallet')}</Button>
            </Link>
          }
        />
      </div>
    )
  }

  if (status === 'loading' || status === 'pending') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-6">
        <Spin size="large" />
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-2">{t('waitingPayment')}</h2>
          <p className="text-sm text-gray-500">{t('waitingHint')}</p>
          {orderInfo && (
            <p className="text-xs text-gray-400 mt-2">
              {t('orderInfo', { orderId: orderId.slice(0, 8), amount: (orderInfo.amountCents / 100).toFixed(2) })}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Result
          status="success"
          title={t('paySuccess')}
          subTitle={
            orderInfo
              ? t('paySuccessMessage', { credits: Number(orderInfo.credits).toLocaleString() })
              : undefined
          }
          extra={[
            <Link href="/app/wallet" key="wallet">
              <Button type="primary">{t('goToWallet')}</Button>
            </Link>,
            <Link href="/app/images" key="create">
              <Button>{t('goCreate')}</Button>
            </Link>,
          ]}
        />
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Result
          status="error"
          title={t('payFailed')}
          subTitle={t('payFailedHint')}
          extra={[
            <Link href="/app/wallet" key="retry">
              <Button type="primary">{t('retryPayment')}</Button>
            </Link>,
          ]}
        />
      </div>
    )
  }

  // error / timeout
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Result
        status="warning"
        title={t('timeoutTitle')}
        subTitle={t('timeoutHint')}
        extra={[
          <Link href="/app/wallet" key="wallet">
            <Button type="primary">{t('goToWallet')}</Button>
          </Link>,
        ]}
      />
    </div>
  )
}
