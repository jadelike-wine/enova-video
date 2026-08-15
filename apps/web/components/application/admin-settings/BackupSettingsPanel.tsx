'use client'

import Link from 'next/link'

export default function BackupSettingsPanel() {
  return (
    <div data-testid="backup-settings-panel" className="space-y-5">
      <div className="text-sm leading-relaxed text-gray-500">备份属于部署与运维能力，不在系统设置中伪造运行时表单。</div>
      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
        <header className="border-b border-gray-100 px-5 py-4 sm:px-6">
          <h3 className="text-sm font-semibold text-gray-900">数据库备份与恢复</h3>
          <p className="mt-0.5 text-xs text-gray-500">使用真实环境变量、仓库脚本和运维文档管理备份。</p>
        </header>
        <div className="space-y-4 px-5 py-5 text-sm leading-relaxed text-gray-600 sm:px-6">
          <p data-testid="backup-environment-vars">备份配置通过 <code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-xs">BACKUP_DIR</code>、<code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-xs">BACKUP_RETENTION_DAYS</code> 和 <code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-xs">BACKUP_S3_BUCKET</code> 等环境变量管理。</p>
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4 text-xs">
            <span>手动备份：<code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-gray-500">./scripts/backup.sh</code></span>
            <Link href="/app/admin/system-update" className="text-primary-600 hover:underline">系统更新</Link>
            <span>文档：<code className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 font-mono text-gray-500">docs/BACKUP.md</code></span>
          </div>
        </div>
      </section>
    </div>
  )
}
