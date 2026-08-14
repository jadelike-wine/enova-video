'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Image as AntdImage } from 'antd'
import { useTranslations } from 'next-intl'
import { billingApi, paymentApi, publicApi, type LedgerEntry, type RechargeResult } from '../../lib/api'
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

function ledgerTypeClass(type?: string): string {
  const note = ['WELCOME', 'RECHARGE', 'SUBSCRIPTION_GRANT', 'REFUND', 'ADMIN_ADJUSTMENT']
  if (note.includes(type ?? '')) return 'badge-completed'
  if (type === 'GENERATION_SETTLE') return 'badge-completed'
  if (type === 'GENERATION_RESERVE' || type === 'GENERATION_RELEASE') return 'badge-progress'
  return 'badge'
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
  const [customCny, setCustomCny] = useState('')
  const [recharging, setRecharging] = useState(false)
  const [rechargeResult, setRechargeResult] = useState<RechargeResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [supportEmail, setSupportEmail] = useState('support@example.com')

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
  }, [alert])

  useEffect(() => {
    void loadWallet()
    void loadLedger()
    void publicApi.siteConfig().then((config) => setSupportEmail(config.supportEmail)).catch(() => undefined)
  }, [loadWallet, loadLedger])

  const effectiveCny =
    customCny.trim() !== '' ? Number(customCny) : selectedCny

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
  }, [effectiveCny, alert])

  const handleSandboxConfirm = useCallback(async () => {
    if (!rechargeResult) return
    setConfirming(true)
    try {
      const res = await paymentApi.sandboxConfirm(rechargeResult.orderId)
      await alert({ title: t('paySuccess'), message: t('paySuccessMessage', { credits: Number(res.credits).toLocaleString() }) })
      setRechargeResult(null)
      setCustomCny('')
      await Promise.all([loadWallet(), refresh(), loadLedger()])
    } catch (e) {
      await alert({ title: t('payConfirmFailed'), message: formatErrorMessage(e) })
    } finally {
      setConfirming(false)
    }
  }, [rechargeResult, alert, loadWallet, refresh, loadLedger])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
            {t('title')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
        </div>
        <Link href="/app/settings" className="btn-secondary text-sm">
          {t('accountSettings')}
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
        </section>

        {/* 充值 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-1">{t('recharge')}</h3>
          <p className="text-sm text-gray-500 mb-4">
            {t('rechargeHint')}
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            {RECHARGE_PRESETS_CNY.map((cny) => {
              const active =
                customCny.trim() === '' && selectedCny === cny
              return (
                <button
                  key={cny}
                  onClick={() => {
                    setSelectedCny(cny)
                    setCustomCny('')
                  }}
                  className={`px-5 py-2.5 rounded-2xl text-sm font-medium border transition-all duration-200 ${
                    active
                      ? 'border-fuchsia-400/50 bg-gradient-to-r from-fuchsia-500/25 to-cyan-400/15 text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  ¥{cny}
                </button>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              value={customCny}
              onChange={(e) => setCustomCny(e.target.value)}
              type="number"
              min={1}
              className="input-field flex-1"
              placeholder={t('customAmount')}
            />
            <button
              className="btn-primary flex-shrink-0"
              disabled={recharging}
              onClick={handleRecharge}
            >
              {recharging ? t('creatingOrder') : t('rechargeNow')}
            </button>
          </div>

          {rechargeResult && (
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5 space-y-4">
              <p className="text-sm text-gray-800">
                {t('orderCreated', { orderId: rechargeResult.orderId.slice(0, 8), credits: Number(rechargeResult.credits).toLocaleString() })}
              </p>
              {rechargeResult.payUrl && (
                <a
                  href={rechargeResult.payUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary inline-block"
                >
                  {t('goToPay')}
                </a>
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
              <button
                className="btn-secondary disabled:opacity-50"
                disabled={confirming}
                onClick={handleSandboxConfirm}
              >
                {confirming ? t('confirming') : t('sandboxConfirm')}
              </button>
            </div>
          )}
        </section>

        {/* 交易流水 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">{t('transactionHistory')}</h3>
            <button
              className="btn-ghost text-xs"
              onClick={() => void loadLedger()}
              disabled={ledgerLoading}
            >
              {tc('common.refresh')}
            </button>
          </div>

          {ledgerLoading && (
            <div className="text-center py-12 text-gray-400">{tc('common.loading')}</div>
          )}

          {!ledgerLoading && ledger.length === 0 && (
            <div className="text-center py-12 text-gray-400">{t('noTransactions')}</div>
          )}

          {!ledgerLoading && ledger.length > 0 && (
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
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${ledgerTypeClass(
                            entry.type,
                          )}`}
                        >
                          {ledgerTypeLabel(t, entry.type)}
                        </span>
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
