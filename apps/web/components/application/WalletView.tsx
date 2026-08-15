'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, Empty, Image as AntdImage, InputNumber, Skeleton, Tag } from 'antd'
import { useTranslations } from 'next-intl'
import { billingApi, paymentApi, type LedgerEntry, type RechargeResult } from '../../lib/api'
import { useSiteConfig } from '../../lib/useSiteConfig'
import { useDialog } from './DialogProvider'
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'

/** 预置充值档位（人民币，元）。 */
const RECHARGE_PRESETS_CNY = [10, 30, 50, 100, 200]

function ledgerTypeLabel(t: ReturnType<typeof useTranslations<'wallet'>>, type?: string): string {
  const knownTypes = ['WELCOME', 'RECHARGE', 'GENERATION_RESERVE', 'GENERATION_SETTLE', 'GENERATION_RELEASE', 'REFUND', 'SUBSCRIPTION_GRANT', 'ADMIN_ADJUSTMENT']
  if (type && knownTypes.includes(type)) {
    return t(`ledgerTypes.${type}` as 'ledgerTypes.WELCOME')
  }
  return type || '—'
}

function ledgerTypeTagColor(type?: string): 'success' | 'processing' | 'default' {
  const note = ['WELCOME', 'RECHARGE', 'SUBSCRIPTION_GRANT', 'REFUND', 'ADMIN_ADJUSTMENT']
  if (note.includes(type ?? '')) return 'success'
  if (type === 'GENERATION_SETTLE') return 'success'
  if (type === 'GENERATION_RESERVE' || type === 'GENERATION_RELEASE') return 'processing'
  return 'default'
}

function formatAmount(amount: number): string {
  const n = Number(amount) || 0
  return n >= 0 ? `+${n.toLocaleString()}` : n.toLocaleString()
}

function amountClass(amount: number): string {
  return (Number(amount) || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export default function WalletView() {
  const t = useTranslations('wallet')
  const tc = useTranslations()
  const { alert } = useDialog()
  const { user, refresh } = useSession()

  const [balance, setBalance] = useState(0)
  const [reservedBalance, setReservedBalance] = useState(0)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [ledgerLoading, setLedgerLoading] = useState(false)

  const [selectedCny, setSelectedCny] = useState<number>(30)
  const [customCny, setCustomCny] = useState<number | null>(null)
  const [recharging, setRecharging] = useState(false)
  const [rechargeResult, setRechargeResult] = useState<RechargeResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const { config: siteConfig } = useSiteConfig()
  const supportEmail = siteConfig.contactInfo || siteConfig.supportEmail || 'support@example.com'

  const loadWallet = useCallback(async () => {
    try {
      const w = await billingApi.wallet()
      setBalance(w.balance)
      setReservedBalance(w.reservedBalance)
    } catch {
      /* 余额已由 session 兜底 */
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const items = await billingApi.ledger(50)
      setLedger(items)
    } catch (e) {
      setLedger([])
      await alert({ title: tc('common.loadFailed'), message: formatErrorMessage(e) })
    } finally {
      setLedgerLoading(false)
    }
  }, [alert, tc])

  useEffect(() => {
    void loadWallet()
    void loadLedger()
  }, [loadWallet, loadLedger])

  const effectiveCny =
    customCny != null && !Number.isNaN(customCny) ? customCny : selectedCny

  const handleRecharge = useCallback(async () => {
    const amountCny = effectiveCny
    if (!Number.isFinite(amountCny) || amountCny <= 0 || amountCny > 100000) {
      await alert({ title: tc('dialog.alertTitle'), message: t('invalidAmount') })
      return
    }
    setRecharging(true)
    setRechargeResult(null)
    try {
      const res = await paymentApi.recharge(Math.round(amountCny * 100))
      setRechargeResult(res)
    } catch (e) {
      await alert({ title: t('createOrderFailed'), message: formatErrorMessage(e) })
    } finally {
      setRecharging(false)
    }
  }, [effectiveCny, alert, tc, t])

  const handleSandboxConfirm = useCallback(async () => {
    if (!rechargeResult) return
    setConfirming(true)
    try {
      const res = await paymentApi.sandboxConfirm(rechargeResult.orderId)
      await alert({ title: t('paySuccess'), message: t('paySuccessMessage', { credits: Number(res.credits).toLocaleString() }) })
      setRechargeResult(null)
      setCustomCny(null)
      await Promise.all([loadWallet(), refresh(), loadLedger()])
    } catch (e) {
      await alert({ title: t('payConfirmFailed'), message: formatErrorMessage(e) })
    } finally {
      setConfirming(false)
    }
  }, [rechargeResult, alert, loadWallet, refresh, loadLedger, t])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
            {t('title')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
        </div>
        <Link href="/app/settings">
          <Button>{t('accountSettings')}</Button>
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {/* 余额总览 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">{t('currentBalance')}</h3>
            {!loading && (
              <span className="text-xs text-gray-400">{user?.email ?? ''}</span>
            )}
          </div>
          {loading ? (
            <Skeleton active paragraph={{ rows: 2 }} />
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
                <p className="text-xs text-gray-400 mb-1">{t('availableBalance')}</p>
                <p className="text-3xl font-extrabold text-cyan-600">
                  {balance.toLocaleString()}
                  <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
                <p className="text-xs text-gray-400 mb-1">{t('reservedBalance')}</p>
                <p className="text-3xl font-extrabold text-amber-600">
                  {reservedBalance.toLocaleString()}
                  <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
                <p className="text-xs text-gray-400 mb-1">{t('totalBalance')}</p>
                <p className="text-3xl font-extrabold text-gray-900">
                  {(balance + reservedBalance).toLocaleString()}
                  <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
                </p>
              </div>
            </div>
          )}
        </section>

        {/* 充值 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-1">{t('recharge')}</h3>
          <p className="text-sm text-gray-500 mb-4">
            {t('rechargeHint')}
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            {RECHARGE_PRESETS_CNY.map((cny) => {
              const active = customCny == null && selectedCny === cny
              return (
                <Button
                  key={cny}
                  type={active ? 'primary' : 'default'}
                  onClick={() => {
                    setSelectedCny(cny)
                    setCustomCny(null)
                  }}
                >
                  ¥{cny}
                </Button>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <InputNumber
              value={customCny ?? undefined}
              onChange={(val) => setCustomCny(val as number | null)}
              min={1}
              className="flex-1"
              placeholder={t('customAmount')}
            />
            <Button
              type="primary"
              loading={recharging}
              onClick={handleRecharge}
              className="flex-shrink-0"
            >
              {recharging ? t('creatingOrder') : t('rechargeNow')}
            </Button>
          </div>

          {rechargeResult && (
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5 space-y-4">
              <p className="text-sm text-gray-800">
                {t('orderCreated', { orderId: rechargeResult.orderId.slice(0, 8), credits: Number(rechargeResult.credits).toLocaleString() })}
              </p>
              {rechargeResult.payUrl && (
                <Button type="primary" href={rechargeResult.payUrl} target="_blank">
                  {t('goToPay')}
                </Button>
              )}
              {rechargeResult.qrCode && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">{t('scanToPay')}</p>
                  <AntdImage
                    src={rechargeResult.qrCode}
                    alt={t('qrCode')}
                    width={160}
                    height={160}
                    preview={false}
                    className="rounded-xl border border-gray-200 bg-white"
                  />
                </div>
              )}
              <Button loading={confirming} onClick={handleSandboxConfirm}>
                {confirming ? t('confirming') : t('sandboxConfirm')}
              </Button>
            </div>
          )}
        </section>

        {/* 交易流水 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">{t('transactionHistory')}</h3>
            <Button
              size="small"
              onClick={() => void loadLedger()}
              loading={ledgerLoading}
            >
              {tc('common.refresh')}
            </Button>
          </div>

          {ledgerLoading ? (
            <Skeleton active />
          ) : ledger.length === 0 ? (
            <Empty description={t('noTransactions')} />
          ) : (
            <div className="space-y-2">
              {ledger.map((entry) => {
                const amount = Number(entry.amount) || 0
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Tag color={ledgerTypeTagColor(entry.type)} className="!m-0 !text-[10px]">
                          {ledgerTypeLabel(t, entry.type)}
                        </Tag>
                        {entry.description && (
                          <span className="text-xs text-gray-400 truncate">
                            {entry.description}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{formatTime(entry.createdAt)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-bold ${amountClass(amount)}`}>
                        {formatAmount(amount)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {t('balanceAfter', { balance: Number(entry.balanceAfter || 0).toLocaleString() })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 客服联系方式 — 退款/订单问题 */}
        <section className="glass-card">
          <h3 className="text-sm font-bold text-gray-900 mb-2">{t('refundTitle')}</h3>
          <div className="space-y-2 text-xs text-gray-500">
            <p>
              {t('refundHint1')}
            </p>
            <p>
              {t('refundHint2')}
            </p>
            <p>
              {t('contactEmail')}
              <a
                href={`mailto:${supportEmail}`}
                className="text-[#7C3AED] underline decoration-[#7C3AED]/40 hover:text-[#6D28D9] ml-1"
              >
                {supportEmail}
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
