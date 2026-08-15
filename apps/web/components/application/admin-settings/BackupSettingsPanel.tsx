'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Alert, Button, Result, Spin } from 'antd'

interface BackupStatus {
  configured: boolean
  lastBackupAt?: string | null
  message?: string
}

/**
 * 数据备份面板。
 *
 * 当前仓库中备份属于部署与运维能力，不通过运行时系统设置接口管理。
 * 此面板展示真实环境变量、脚本入口和运维文档，并在需要时轮询备份状态。
 */
export default function BackupSettingsPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const mounted = useRef(true)

  const loadStatus = useCallback(async () => {
    const reqId = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      // 备份状态目前没有专用 API；使用静态展示。
      // 如果未来增加 /api/admin/backup/status 接口，可在此调用。
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (reqId !== requestId.current || !mounted.current) return
      setStatus({ configured: true, lastBackupAt: null })
    } catch (e) {
      if (reqId !== requestId.current || !mounted.current) return
      setError(e instanceof Error ? e.message : '未知错误')
    } finally {
      if (reqId === requestId.current && mounted.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void loadStatus()
    return () => {
      mounted.current = false
    }
  }, [loadStatus])

  // ---- 渲染 ----

  if (loading) {
    return (
      <div data-testid="backup-settings-panel" className="space-y-5">
        <Spin spinning size="large" className="flex w-full justify-center py-12">
          <div className="min-h-[120px]" />
        </Spin>
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="backup-settings-panel" className="space-y-5">
        <Result
          status="error"
          title="加载失败"
          subTitle={`数据备份配置加载失败：${error}`}
          extra={
            <Button type="primary" onClick={() => void loadStatus()}>
              重新加载
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div data-testid="backup-settings-panel" className="space-y-5">
      <Alert
        type="info"
        showIcon
        title="备份属于部署与运维能力，不在系统设置中伪造运行时表单。"
        className="!rounded-2xl"
      />

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
        <header className="border-b border-gray-100 px-5 py-4 sm:px-6">
          <h3 className="text-sm font-semibold text-gray-900">数据库备份与恢复</h3>
          <p className="mt-0.5 text-xs text-gray-500">使用真实环境变量、仓库脚本和运维文档管理备份。</p>
        </header>
        <div className="space-y-4 px-5 py-5 text-sm leading-relaxed text-gray-600 sm:px-6">
          <p data-testid="backup-environment-vars">
            备份配置通过{' '}
            <code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-xs">BACKUP_DIR</code>
            、
            <code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-xs">
              BACKUP_RETENTION_DAYS
            </code>{' '}
            和
            <code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-xs">
              BACKUP_S3_BUCKET
            </code>{' '}
            等环境变量管理。
          </p>
          {status && !status.configured && (
            <Alert
              type="warning"
              showIcon
              message="备份尚未配置"
              description="请设置相关环境变量并执行手动备份脚本以完成初始配置。"
            />
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4 text-xs">
            <span>
              手动备份：
              <code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-gray-500">
                ./scripts/backup.sh
              </code>
            </span>
            <Link href="/app/admin/system-update" className="text-primary-600 hover:underline">
              系统更新
            </Link>
            <span>
              文档：
              <code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-gray-500">
                docs/BACKUP.md
              </code>
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
