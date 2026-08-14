'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { billingApi, paymentApi, publicApi, type LedgerEntry, type RechargeResult } from '../../lib/api'
import { useDialog } from './DialogProvider'
import { useSession } from '../../lib/auth'
import { formatErrorMessage } from '../../lib/errorMessage'

/** 预置充值档位（人民币，元）。 */
const RECHARGE_PRESETS_CNY = [10, 30, 50, 100, 200]

const LEDGER_TYPE_LABEL: Record<string, string> = {
  WELCOME: '新用户赠送',
  RECHARGE: '充值',
  GENERATION_RESERVE: '生成预留',
  GENERATION_SETTLE: '生成结算',
  GENERATION_RELEASE: '生成释放',
  REFUND: '退款',
  SUBSCRIPTION_GRANT: '订阅发放',
  ADMIN_ADJUSTMENT: '管理员调整',
}

function ledgerTypeLabel(type?: string): string {
  return LEDGER_TYPE_LABEL[type ?? ''] || type || '—'
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
      await alert({ title: '加载失败', message: formatErrorMessage(e) })
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
      await alert({ title: '提示', message: '请输入有效充值金额（1 ~ 100000 元）' })
      return
    }
    setRecharging(true)
    setRechargeResult(null)
    try {
      const res = await paymentApi.recharge(Math.round(amountCny * 100))
      setRechargeResult(res)
    } catch (e) {
      await alert({ title: '创建订单失败', message: formatErrorMessage(e) })
    } finally {
      setRecharging(false)
    }
  }, [effectiveCny, alert])

  const handleSandboxConfirm = useCallback(async () => {
    if (!rechargeResult) return
    setConfirming(true)
    try {
      const res = await paymentApi.sandboxConfirm(rechargeResult.orderId)
      await alert({ title: '支付成功', message: `已到账 +${Number(res.credits).toLocaleString()} Credits` })
      setRechargeResult(null)
      setCustomCny('')
      await Promise.all([loadWallet(), refresh(), loadLedger()])
    } catch (e) {
      await alert({ title: '确认失败', message: formatErrorMessage(e) })
    } finally {
      setConfirming(false)
    }
  }, [rechargeResult, alert, loadWallet, refresh, loadLedger])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
            钱包
          </h2>
          <p className="text-sm text-gray-500 mt-1">充值 Credits，用于对话与图片/视频生成</p>
        </div>
        <Link href="/app/settings" className="btn-secondary text-sm">
          账户设置
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {/* 余额总览 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">当前余额</h3>
            {!loading && (
              <span className="text-xs text-gray-400">{user?.email ?? ''}</span>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">可用余额</p>
              <p className="text-3xl font-extrabold text-cyan-600">
                {balance.toLocaleString()}
                <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">已预留（进行中任务）</p>
              <p className="text-3xl font-extrabold text-amber-600">
                {reservedBalance.toLocaleString()}
                <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">总余额</p>
              <p className="text-3xl font-extrabold text-gray-900">
                {(balance + reservedBalance).toLocaleString()}
                <span className="text-sm font-normal text-gray-500 ml-1">Credits</span>
              </p>
            </div>
          </div>
        </section>

        {/* 充值 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-1">充值</h3>
          <p className="text-sm text-gray-500 mb-4">
            选择或输入充值金额（人民币），创建订单后完成支付，Credits 即时到账。
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
              placeholder="自定义金额（元）"
            />
            <button
              className="btn-primary flex-shrink-0"
              disabled={recharging}
              onClick={handleRecharge}
            >
              {recharging ? '创建订单中…' : '立即充值'}
            </button>
          </div>

          {rechargeResult && (
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5 space-y-4">
              <p className="text-sm text-gray-800">
                订单 <code className="text-cyan-600">{rechargeResult.orderId.slice(0, 8)}</code>{' '}
                已创建，到账{' '}
                <strong className="text-cyan-600">
                  +{Number(rechargeResult.credits).toLocaleString()} Credits
                </strong>
              </p>
              {rechargeResult.payUrl && (
                <a
                  href={rechargeResult.payUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary inline-block"
                >
                  前往支付
                </a>
              )}
              {rechargeResult.qrCode && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">扫码支付：</p>
                  <img
                    src={rechargeResult.qrCode}
                    alt="支付二维码"
                    className="w-40 h-40 rounded-xl border border-gray-200 bg-white"
                  />
                </div>
              )}
              <button
                className="btn-secondary disabled:opacity-50"
                disabled={confirming}
                onClick={handleSandboxConfirm}
              >
                {confirming ? '确认中…' : '模拟确认支付（演示模式）'}
              </button>
            </div>
          )}
        </section>

        {/* 交易流水 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">交易流水</h3>
            <button
              className="btn-ghost text-xs"
              onClick={() => void loadLedger()}
              disabled={ledgerLoading}
            >
              刷新
            </button>
          </div>

          {ledgerLoading && (
            <div className="text-center py-12 text-gray-400">加载中…</div>
          )}

          {!ledgerLoading && ledger.length === 0 && (
            <div className="text-center py-12 text-gray-400">暂无交易记录</div>
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
                          {ledgerTypeLabel(entry.type)}
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
                        余额 {Number(entry.balanceAfter || 0).toLocaleString()}
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
          <h3 className="text-sm font-bold text-gray-900 mb-2">退款与订单问题</h3>
          <div className="space-y-2 text-xs text-gray-500">
            <p>
              退款需联系客服人工处理，系统不会自动退款。
            </p>
            <p>
              请提供订单号和付款账号信息，客服将在 1-3 个工作日内处理。
            </p>
            <p>
              联系邮箱：
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
