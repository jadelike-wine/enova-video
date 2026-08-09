'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { settingsApi } from '../../lib/api'
import { useDialog } from './DialogProvider'

export const NO_API_KEY_TITLE = '无法操作'
export const NO_API_KEY_MESSAGE =
  '尚未配置 Agnes AI API Key，无法执行此操作。请前往「设置」页面添加并启用 API Key。'

export const NO_QINIU_TITLE = '需要对象存储'
export const NO_QINIU_MESSAGE =
  '尚未配置七牛云对象存储，无法上传参考图片。请在 backend/.env 中配置 QINIU_ACCESS_KEY、QINIU_SECRET_KEY、QINIU_BUCKET、QINIU_DOMAIN 后重启后端。详细说明请见「设置」页面。'

export function imageModeNeedsQiniu(mode: string): boolean {
  return mode !== 'text2img'
}

export function videoModeNeedsQiniu(mode: string): boolean {
  return mode !== 'text2video'
}

export function useApiKeyGuard() {
  const router = useRouter()
  const { confirm } = useDialog()

  const [hasActiveKey, setHasActiveKey] = useState(true)
  const [hasQiniuConfig, setHasQiniuConfig] = useState(true)
  const [keyStatusLoading, setKeyStatusLoading] = useState(true)

  const refreshKeyStatus = useCallback(async () => {
    setKeyStatusLoading(true)
    try {
      const status = (await settingsApi.getStatus()) as {
        has_active_key: boolean
        has_qiniu_config: boolean
      }
      setHasActiveKey(status.has_active_key)
      setHasQiniuConfig(status.has_qiniu_config)
    } catch {
      setHasActiveKey(false)
      setHasQiniuConfig(false)
    } finally {
      setKeyStatusLoading(false)
    }
  }, [])

  const requireApiKey = useCallback(async (): Promise<boolean> => {
    await refreshKeyStatus()
    if (hasActiveKey) return true

    const goSettings = await confirm({
      title: NO_API_KEY_TITLE,
      message: NO_API_KEY_MESSAGE,
      confirmText: '前往设置',
      cancelText: '取消',
      confirmVariant: 'primary',
    })
    if (goSettings) {
      router.push('/app/settings')
    }
    return false
  }, [refreshKeyStatus, hasActiveKey, confirm, router])

  const requireQiniuConfig = useCallback(async (): Promise<boolean> => {
    await refreshKeyStatus()
    if (hasQiniuConfig) return true

    const goSettings = await confirm({
      title: NO_QINIU_TITLE,
      message: NO_QINIU_MESSAGE,
      confirmText: '查看说明',
      cancelText: '取消',
      confirmVariant: 'primary',
    })
    if (goSettings) {
      router.push('/app/settings#storage')
    }
    return false
  }, [refreshKeyStatus, hasQiniuConfig, confirm, router])

  return {
    hasActiveKey,
    hasQiniuConfig,
    keyStatusLoading,
    refreshKeyStatus,
    requireApiKey,
    requireQiniuConfig,
  }
}