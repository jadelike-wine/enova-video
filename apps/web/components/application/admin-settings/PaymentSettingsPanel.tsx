'use client'

import { SettingGrid, SettingsSaveFooter, SettingsSection, settingsDirty } from './SettingsPanelPrimitives'
import type { SettingsPanelProps } from './SettingsPanelPrimitives'

export default function PaymentSettingsPanel({ settings, drafts, onDraftChange, onBatchSave, saving, saved }: SettingsPanelProps) {
  const common = settings.filter((setting) => ['payment.mode', 'payment.creditsPerCny', 'payment.minRechargeCents', 'payment.returnBaseUrl', 'payment.notifyUrl'].includes(setting.key))
  const alipay = settings.filter((setting) => setting.key.startsWith('payment.alipay'))
  const wechat = settings.filter((setting) => setting.key.startsWith('payment.wechat'))
  return (
    <div data-testid="payment-settings-panel" className="space-y-5">
      <div className="text-sm leading-relaxed text-gray-500">配置 Enova Credits 充值渠道。真实支付宝/微信渠道需要服务端商户凭证，Secret 继续加密保存并保持留空不覆盖。</div>
      <SettingsSection title="充值基础设置" description="沙箱模式用于本地演示；兑换汇率和最小充值金额使用整数单位。"><SettingGrid settings={common} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>
      {alipay.length > 0 && <SettingsSection title="支付宝" description="接入真实支付宝渠道时填写商户 AppId、签名密钥和网关地址。"><SettingGrid settings={alipay} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      {wechat.length > 0 && <SettingsSection title="微信支付" description="接入真实微信支付渠道时填写商户号、APIv3 密钥、证书序列号和私钥。"><SettingGrid settings={wechat} drafts={drafts} onDraftChange={onDraftChange} /></SettingsSection>}
      <SettingsSaveFooter dirty={settingsDirty(settings, drafts)} saving={saving} saved={saved} onSave={() => void onBatchSave(settings.map((setting) => setting.key))} note="支付设置继续通过 payment group 的原子 batch 保存，不改变支付回调和 Secret 语义。" />
    </div>
  )
}
