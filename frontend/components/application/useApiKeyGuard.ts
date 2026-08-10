'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { settingsApi } from '../../lib/api'
import { useDialog } from './DialogProvider'

export const NO_API_KEY_TITLE = '无法操作'
export const NO_API_KEY_MESSAGE =
  '尚未配置 Agnes AI API Key，无法执行此操作。请前往「设置」页面添加并启用 API Key。'

export const NO_STORAGE_TITLE = '需要对象存储'
export const NO_STORAGE_MESSAGE =
  '尚未配置对象存储（七牛云或 AWS S3），无法上传参考图片。请在「设置」页面或 backend/.env 中配置存储服务后重启后端。详细说明请见「设置」页面。'

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
  const [hasStorageConfig, setHasStorageConfig] = useState(true)
  const [keyStatusLoading, setKeyStatusLoading] = useState(true)

  const refreshKeyStatus = useCallback(async (): Promise<{
    has_active_key: boolean
    has_qiniu_config: boolean
    storage?: { ready?: boolean }
  }> => {
    setKeyStatusLoading(true)
    try {
      const status = (await settingsApi.getStatus()) as {
        has_active_key: boolean
        has_qiniu_config: boolean
        storage?: { ready?: boolean }
      }
      setHasActiveKey(status.has_active_key)
      // 兼容旧后端：无 storage 字段时回退到 has_qiniu_config
      const storageReady = status.storage?.ready ?? status.has_qiniu_config
      setHasStorageConfig(storageReady)
      return status
    } catch {
      const fallback = { has_active_key: false, has_qiniu_config: false }
      setHasActiveKey(false)
      setHasStorageConfig(false)
      return fallback
    } finally {
      setKeyStatusLoading(false)
    }
  }, [])

  const requireApiKey = useCallback(async (): Promise<boolean> => {
    const status = await refreshKeyStatus()
    if (status.has_active_key) return true

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
  }, [refreshKeyStatus, confirm, router])

  const requireStorageConfig = useCallback(async (): Promise<boolean> => {
    const status = await refreshKeyStatus()
    if (status.storage?.ready ?? status.has_qiniu_config) return true

    const goSettings = await confirm({
      title: NO_STORAGE_TITLE,
      message: NO_STORAGE_MESSAGE,
      confirmText: '查看说明',
      cancelText: '取消',
      confirmVariant: 'primary',
    })
    if (goSettings) {
      router.push('/app/settings#storage')
    }
    return false
  }, [refreshKeyStatus, confirm, router])

  return {
    hasActiveKey,
    hasStorageConfig,
    keyStatusLoading,
    refreshKeyStatus,
    requireApiKey,
    requireStorageConfig,
  }
}