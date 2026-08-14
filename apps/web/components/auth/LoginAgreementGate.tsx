'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, Checkbox, Modal } from 'antd'
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
      <div className="mb-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          登录条款加载失败，请刷新页面后重试。
        </div>
      </div>
    )
  }

  if (!config) {
    return <p className="text-xs text-gray-400">正在加载登录条款…</p>
  }

  if (!config.enabled) return null

  return (
    <>
      {config.mode === 'checkbox' ? (
        <Checkbox
          checked={accepted}
          onChange={(e) => (e.target.checked ? accept() : reject())}
          className="mb-2"
        >
          <span className="text-sm text-gray-600">
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
        </Checkbox>
      ) : (
        <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
          <div className="flex items-center justify-between gap-3">
            <span>登录前请阅读并同意当前服务条款。</span>
            <Button type="link" size="small" onClick={() => setShowModal(true)}>
              查看条款
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={showModal && !accepted}
        title="登录条款"
        onCancel={reject}
        footer={[
          <Button key="reject" onClick={reject}>
            暂不接受
          </Button>,
          <Button key="accept" type="primary" onClick={accept}>
            我已阅读并同意
          </Button>,
        ]}
      >
        {config.updatedAt && (
          <p className="mb-2 text-xs text-gray-500">更新日期：{config.updatedAt}</p>
        )}
        <div className="grid gap-2">
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
      </Modal>
    </>
  )
}
