'use client'

import { useCallback, useRef } from 'react'

export function useClipboard(resetMs = 2000) {
  const copiedKeyRef = useRef<string | null>(null)
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
      copiedKeyRef.current = key
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (copiedKeyRef.current === key) copiedKeyRef.current = null
      }, resetMs)
      return true
    },
    [resetMs],
  )

  const isCopied = useCallback((key: string): boolean => {
    return copiedKeyRef.current === key
  }, [])

  return { copyText, isCopied }
}