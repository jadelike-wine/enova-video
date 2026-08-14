'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { publicApi, type LoginAgreementConfig } from '../../lib/api'

export interface LoginAgreementGateState {
  ready: boolean
  enabled: boolean
  accepted: boolean
  revision: string
}

interface LoginAgreementGateProps {
  onStateChange: (state: LoginAgreementGateState) => void
}

export default function LoginAgreementGate({ onStateChange }: LoginAgreementGateProps) {
  const [config, setConfig] = useState<LoginAgreementConfig | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let active = true
    publicApi
      .loginAgreement()
      .then((next) => {
        if (!active) return
        setConfig(next)
        setAccepted(!next.enabled)
        setShowModal(next.enabled && next.mode === 'modal')
        setLoadError(false)
      })
      .catch(() => {
        if (!active) return
        setConfig(null)
        setAccepted(false)
        setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    onStateChange({
      ready: config !== null && !loadError,
      enabled: config?.enabled ?? false,
      accepted,
      revision: config?.revision ?? '',
    })
  }, [accepted, config, loadError, onStateChange])

  const accept = () => {
    setAccepted(true)
    setShowModal(false)
  }

  const reject = () => {
    setAccepted(false)
    setShowModal(false)
  }

  if (loadError) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
        登录条款加载失败，请刷新页面后重试。
      </p>
    )
  }

  if (!config) {
    return <p className="text-xs text-gray-400">正在加载登录条款…</p>
  }

  if (!config.enabled) return null

  return (
    <>
      {config.mode === 'checkbox' ? (
        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => (event.target.checked ? accept() : reject())}
            className="mt-0.5 h-4 w-4 rounded"
          />
          <span>
            我已阅读并同意{' '}
            {config.documents.map((document, index) => (
              <span key={document.slug}>
                <Link
                  href={`/legal/${encodeURIComponent(document.slug)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#7C3AED] hover:underline"
                >
                  {document.title}
                </Link>
                {index < config.documents.length - 1 ? '、' : ''}
              </span>
            ))}
          </span>
        </label>
      ) : (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
          <div className="flex items-center justify-between gap-3">
            <span>登录前请阅读并同意当前服务条款。</span>
            <button type="button" className="text-violet-700 underline" onClick={() => setShowModal(true)}>
              查看条款
            </button>
          </div>
        </div>
      )}

      {showModal && !accepted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card w-full max-w-lg p-6">
            <h2 className="text-xl font-bold text-gray-900">登录条款</h2>
            {config.updatedAt && <p className="mt-1 text-xs text-gray-500">更新日期：{config.updatedAt}</p>}
            <div className="mt-4 grid gap-2">
              {config.documents.map((document) => (
                <Link
                  key={document.slug}
                  href={`/legal/${encodeURIComponent(document.slug)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-violet-700 hover:bg-violet-50"
                >
                  {document.title} ↗
                </Link>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" className="btn-secondary" onClick={reject}>
                暂不接受
              </button>
              <button type="button" className="btn-primary" onClick={accept}>
                我已阅读并同意
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
