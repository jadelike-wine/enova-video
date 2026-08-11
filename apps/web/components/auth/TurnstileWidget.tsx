'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'flexible'
}

interface TurnstileAPI {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI
    onTurnstileLoad?: () => void
  }
}

interface Props {
  siteKey: string
  onVerify: (token: string) => void
  onExpire?: () => void
  onError?: () => void
}

export type TurnstileHandle = { reset: () => void }

/** Cloudflare Turnstile 验证组件：加载官方脚本并按 siteKey 渲染。 */
const TurnstileWidget = forwardRef<TurnstileHandle, Props>(function TurnstileWidget(
  { siteKey, onVerify, onExpire, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  const loadScript = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (window.turnstile) {
        resolve()
        return
      }
      const existing = document.querySelector('script[src*="turnstile"]')
      if (existing) {
        window.onTurnstileLoad = () => resolve()
        return
      }
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'
      script.async = true
      script.defer = true
      window.onTurnstileLoad = () => resolve()
      script.onerror = () => reject(new Error('Failed to load Turnstile script'))
      document.head.appendChild(script)
    })

  const renderWidget = () => {
    if (!window.turnstile || !containerRef.current) return
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current)
      } catch {
        /* ignore */
      }
      widgetIdRef.current = null
    }
    if (containerRef.current) containerRef.current.innerHTML = ''
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token: string) => onVerify(token),
      'expired-callback': () => onExpire?.(),
      'error-callback': () => onError?.(),
      theme: 'auto',
      size: 'flexible',
    })
  }

  useEffect(() => {
    let disposed = false
    loadScript()
      .then(() => {
        if (!disposed) renderWidget()
      })
      .catch(() => onError?.())
    return () => {
      disposed = true
      if (window.turnstile && widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current)
    },
  }))

  return (
    <div className="w-full">
      <div ref={containerRef} className="w-full min-h-[65px]" />
    </div>
  )
})

export default TurnstileWidget
