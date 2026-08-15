'use client'

import Link from 'next/link'
import { Button } from 'antd'
import { useTranslations } from 'next-intl'
import { useSession } from '../../lib/auth'
import { BRAND } from '../../lib/brand'
import { useSiteConfig } from '../../lib/useSiteConfig'

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email || '—'
  const [name, domain] = email.split('@')
  const visible = name.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`
}

export default function SettingsView() {
  const t = useTranslations('settings')
  const { user, balance, reservedBalance, logout } = useSession()
  const { config: siteConfig } = useSiteConfig()
  const contactInfo = siteConfig.contactInfo || siteConfig.supportEmail || ''

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-8 py-6 border-b border-gray-200">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
          {t('title')}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {/* 账户信息 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-4">{t('accountInfo')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('email')}</p>
              <p className="text-gray-800 font-medium break-all">{user ? maskEmail(user.email) : '—'}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('role')}</p>
              <p className="text-gray-800 font-medium">
                {user ? (t(`roles.${user.role}` as 'roles.USER' | 'roles.ADMIN') as string) || user.role : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('accountStatus')}</p>
              <p className="text-gray-800 font-medium">
                {user ? (t(`statuses.${user.status}` as 'statuses.ACTIVE') as string) || user.status : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('userId')}</p>
              <p className="text-gray-800 font-mono text-sm break-all">
                {user ? user.userId : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('workspace')}</p>
              <p className="text-gray-800 font-mono text-sm">
                {user ? user.workspaceId.slice(0, 8) : '—'}
              </p>
            </div>
          </div>
        </section>

        {/* 余额概览 */}
        <section className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">{t('balanceOverview')}</h3>
            <Link href="/app/wallet">
              <Button size="small">{t('goToWallet')}</Button>
            </Link>
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

        {/* 平台说明 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-3">{t('aboutPlatform')}</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li>
              {t('aboutPlatformItem1')}
            </li>
            <li>
              {t('aboutPlatformItem2')}
            </li>
            <li>
              {t('aboutPlatformItem3')}
            </li>
          </ul>
          {contactInfo && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{t('contactInfo')}</p>
              <p className="text-sm text-gray-700">
                <a
                  href={contactInfo.includes('@') ? `mailto:${contactInfo}` : contactInfo}
                  className="text-[#7C3AED] underline decoration-[#7C3AED]/40 hover:text-[#6D28D9]"
                >
                  {contactInfo}
                </a>
              </p>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4">
            {BRAND.nameZh} ({BRAND.name}) · {BRAND.taglineZh}
          </p>
        </section>

        {/* 退出登录 */}
        <section className="glass-card">
          <h3 className="text-lg font-bold text-gray-900 mb-2">{t('loginStatus')}</h3>
          <p className="text-sm text-gray-500 mb-4">{t('logoutHint')}</p>
          <Button danger onClick={() => void logout()}>
            {t('logout')}
          </Button>
        </section>
      </div>
    </div>
  )
}
