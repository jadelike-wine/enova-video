'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useSession } from '../../lib/auth'
import { useDialog } from './DialogProvider'

/**
 * 新架构守卫：图片/视频生成前校验账户状态。
 *
 * 新架构不再有「用户自配 Agnes API Key」「用户自配对象存储」的概念——
 * Provider 凭据由平台 Admin 加密托管，存储由平台统一配置。因此这里的守卫
 * 只做一件事：确认余额充足（生成需要预留 Credits）。
 */


/** 兼容旧导出：新架构任何模式都无需前置存储配置。 */
export function imageModeNeedsQiniu(): boolean {
  return false
}

/** 兼容旧导出：新架构任何模式都无需前置存储配置。 */
export function videoModeNeedsQiniu(): boolean {
  return false
}

export function useApiKeyGuard() {
  const t = useTranslations('guard')
  const router = useRouter()
  const { balance, refresh } = useSession()
  const { confirm } = useDialog()

  const [keyStatusLoading, setKeyStatusLoading] = useState(true)

  const refreshKeyStatus = useCallback(async () => {
    setKeyStatusLoading(true)
    try {
      await refresh()
    } catch {
      /* 保持现有余额展示 */
    } finally {
      setKeyStatusLoading(false)
    }
    return { has_active_key: balance > 0, has_qiniu_config: true }
  }, [refresh, balance])

  const requireApiKey = useCallback(async (): Promise<boolean> => {
    if (balance > 0) return true

    const goWallet = await confirm({
      title: t('insufficientBalanceTitle'),
      message: t('insufficientBalanceMessage'),
      confirmText: t('goToWallet'),
      cancelText: t('cancel'),
      confirmVariant: 'primary',
    })
    if (goWallet) {
      router.push('/app/wallet')
    }
    return false
  }, [balance, confirm, router])

  const requireStorageConfig = useCallback(async (): Promise<boolean> => true, [])

  return {
    hasActiveKey: balance > 0,
    hasStorageConfig: true,
    keyStatusLoading,
    refreshKeyStatus,
    requireApiKey,
    requireStorageConfig,
  }
}