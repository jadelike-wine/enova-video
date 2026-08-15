'use client'

import { Button, Input, Segmented, Switch } from 'antd'

import AgreementDocumentsEditor from '../AgreementDocumentsEditor'
import { AGREEMENT_DOCUMENTS_KEY } from './settings-tabs'
import {
  SettingsSaveFooter,
  SettingsSection,
  settingValue,
  settingsDirty,
} from './SettingsPanelPrimitives'
import type { SettingsPanelProps } from './SettingsPanelPrimitives'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface AgreementSettingsPanelProps extends SettingsPanelProps {
  onShowHistory?: (key: string, label: string) => void
}

export default function AgreementSettingsPanel({
  settings,
  drafts,
  onDraftChange,
  onBatchSave,
  saving,
  saved,
  onShowHistory,
}: AgreementSettingsPanelProps) {
  const get = (key: string) => settingValue(settings, drafts, key)
  const enabled = get('general.loginAgreementEnabled') === 'true'
  const mode = get('general.loginAgreementMode') || 'modal'
  const updatedAt = get('general.loginAgreementUpdatedAt')
  const agreementKeys = settings.map((setting) => setting.key)
  const history = (key: string, label: string) => onShowHistory ? (
    <Button type="link" size="small" className="!px-0 !text-xs !text-gray-400" onClick={() => onShowHistory(key, label)}>
      查看历史
    </Button>
  ) : null

  return (
    <div data-testid="agreement-settings-panel" className="space-y-5">
      <SettingsSection title="登录条款" description="控制登录和注册时是否要求用户阅读并同意服务条款、隐私政策及其他 Markdown 文档。">
        <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-gray-900">启用登录条款</div>
            <p className={`mt-1 text-xs ${enabled ? 'text-emerald-600' : 'text-gray-400'}`}>{enabled ? '已启用' : '未启用'}</p>
          </div>
          <Switch checked={enabled} onChange={(next) => onDraftChange('general.loginAgreementEnabled', next ? 'true' : 'false')} aria-label="启用登录条款" />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-gray-800">条款展示形式 {history('general.loginAgreementMode', '条款展示形式')}</div>
            <Segmented
              value={mode}
              onChange={(next) => onDraftChange('general.loginAgreementMode', String(next))}
              options={[{ value: 'modal', label: '弹窗' }, { value: 'checkbox', label: '复选框' }]}
              className="mt-2"
            />
            <p className="mt-2 text-xs leading-relaxed text-gray-500">{mode === 'checkbox' ? '复选框显示在登录按钮下方，未勾选时登录和注册不可用。' : '登录页将弹出条款窗口，用户确认后才能继续。'}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-gray-800">条款更新日期 {history('general.loginAgreementUpdatedAt', '条款更新日期')}</div>
            <Input
              type={updatedAt === '' || DATE_PATTERN.test(updatedAt) ? 'date' : 'text'}
              value={updatedAt}
              placeholder="YYYY-MM-DD"
              onChange={(event) => onDraftChange('general.loginAgreementUpdatedAt', event.target.value)}
              aria-label="条款更新日期"
              className="mt-2 w-full"
            />
            <p className="mt-2 text-xs leading-relaxed text-gray-500">日期或文档内容变化后，用户需要重新同意。</p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="协议文档" description="文档名称可自定义，内容按 Markdown 保存；可参考服务条款、隐私政策和使用政策。">
        <AgreementDocumentsEditor value={get(AGREEMENT_DOCUMENTS_KEY) || '[]'} onChange={(value) => onDraftChange(AGREEMENT_DOCUMENTS_KEY, value)} />
        {settings.filter((setting) => setting.key === AGREEMENT_DOCUMENTS_KEY).length > 0 && history(AGREEMENT_DOCUMENTS_KEY, '协议文档')}
      </SettingsSection>

      <SettingsSaveFooter
        dirty={settingsDirty(settings, drafts)}
        saving={saving}
        saved={saved}
        onSave={() => void onBatchSave(agreementKeys)}
        note="保存后立即生效；条款版本变化后，用户下次登录需重新确认。"
      />
    </div>
  )
}
