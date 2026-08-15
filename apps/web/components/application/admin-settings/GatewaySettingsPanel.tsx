'use client'

import { Button, Tag } from 'antd'

import {
  SettingGrid,
  SettingsSaveFooter,
  SettingsSection,
  settingValue,
  settingsDirty,
} from './SettingsPanelPrimitives.js'
import type { SettingsPanelProps } from './SettingsPanelPrimitives.js'

const AWS_KEYS = new Set(['storage.awsRegion', 'storage.awsS3Bucket', 'storage.awsS3Prefix', 'storage.awsS3PublicBaseUrl', 'storage.awsS3EndpointUrl', 'storage.awsAccessKeyId', 'storage.awsSecretAccessKey', 'storage.awsSessionToken'])
const QINIU_KEYS = new Set(['storage.qiniuAccessKey', 'storage.qiniuSecretKey', 'storage.qiniuBucket', 'storage.qiniuDomain', 'storage.qiniuRegion'])

export interface GatewaySettingsPanelProps extends SettingsPanelProps {
  onStorageTest?: () => Promise<void> | void
}

export default function GatewaySettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved, onStorageTest }: GatewaySettingsPanelProps) {
  const queue = settings.filter((setting) => setting.group === 'queue')
  const storage = settings.filter((setting) => setting.group === 'storage')
  const provider = settingValue(settings, drafts, 'storage.provider') || 'aws_s3'
  const activeStorage = storage.filter((setting) => setting.key === 'storage.provider' || (provider === 'aws_s3' ? !QINIU_KEYS.has(setting.key) : provider === 'qiniu' ? !AWS_KEYS.has(setting.key) : !AWS_KEYS.has(setting.key) && !QINIU_KEYS.has(setting.key)))
  const awsConfigured = Boolean(settingValue(settings, drafts, 'storage.awsS3Bucket') && (settings.find((setting) => setting.key === 'storage.awsAccessKeyId')?.configured || settingValue(settings, drafts, 'storage.awsAccessKeyId')) === (settings.find((setting) => setting.key === 'storage.awsSecretAccessKey')?.configured || settingValue(settings, drafts, 'storage.awsSecretAccessKey')))
  const qiniuConfigured = Boolean(settingValue(settings, drafts, 'storage.qiniuAccessKey') && settingValue(settings, drafts, 'storage.qiniuSecretKey') && settingValue(settings, drafts, 'storage.qiniuBucket') && settingValue(settings, drafts, 'storage.qiniuDomain'))
  const storageConfigured = provider === 'none' || (provider === 'aws_s3' ? awsConfigured : qiniuConfigured)

  return (
    <div data-testid="gateway-settings-panel" className="space-y-5">
      <div className="text-sm leading-relaxed text-gray-500">统一管理生成任务策略和对象存储。Worker 并发等字段修改后按注册表提示重启对应进程。</div>
      {queue.length > 0 && <SettingsSection title="生成任务" description="生成任务并发、重试、视频轮询和 Provider 调用策略。"><SettingGrid settings={queue} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      {storage.length > 0 && <SettingsSection title="对象存储" description="生成结果转存、远程下载限制和 Provider 凭证。未配置完成时保持服务可运行并降级为 none.">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <div><div className="text-sm font-medium text-gray-900">对象存储状态</div><p className="mt-1 text-xs text-gray-500">当前 Provider：{provider}</p></div>
          <div className="flex items-center gap-2"><Tag color={storageConfigured ? 'success' : 'warning'}>{storageConfigured ? '已配置' : '请完善配置'}</Tag>{onStorageTest && provider !== 'none' && <Button size="small" loading={saving} disabled={!storageConfigured} onClick={() => void onStorageTest()}>测试存储</Button>}</div>
        </div>
        <SettingGrid settings={activeStorage} drafts={drafts} onDraftChange={onDraftChange} />
      </SettingsSection>}
      <SettingsSaveFooter dirty={settingsDirty(settings, drafts)} saving={saving} saved={saved} onSave={() => void onBatchSave(settings.map((setting) => setting.key))} note="存储配置继续使用现有成组原子保存、Secret 脱敏和存储测试逻辑。" />
    </div>
  )
}
