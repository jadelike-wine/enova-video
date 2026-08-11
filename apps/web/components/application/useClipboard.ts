'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export function useClipboard(resetMs = 2000) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copyText = useCallback(
    async (text: string, key: string): Promise<boolean> => {
      if (!text?.trim()) return false
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedKey(key)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setCopiedKey((cur) => (cur === key ? null : cur))
        timerRef.current = null
      }, resetMs)
      return true
    },
    [resetMs],
  )

  const isCopied = useCallback((key: string): boolean => {
    return copiedKey === key
  }, [copiedKey])

  // Clear pending timer on unmount to avoid setting state after unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { copyText, isCopied }
}