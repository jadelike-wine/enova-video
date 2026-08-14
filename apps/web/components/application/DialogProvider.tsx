'use client'

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from 'react'
import { App } from 'antd'
import { useTranslations } from 'next-intl'

export interface DialogState {
  visible: boolean
  type: 'confirm' | 'alert'
  title: string
  message: string
  confirmText: string
  cancelText: string
  confirmVariant: 'primary' | 'danger'
}

interface DialogContextValue {
  confirm: (options: DialogOptions) => Promise<boolean>
  alert: (options: DialogOptions) => Promise<boolean>
}

type DialogOptions =
  | string
  | {
      title?: string
      message?: string
      confirmText?: string
      cancelText?: string
      confirmVariant?: 'primary' | 'danger'
    }

const DialogContext = createContext<DialogContextValue | null>(null)

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogProvider')
  return ctx
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('dialog')
  const { modal } = App.useApp()
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const resolve = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
  }, [])

  const open = useCallback(
    (options: DialogOptions, type: DialogState['type']) => {
      const opts = typeof options === 'string' ? { message: options } : options
      const title = opts.title || (type === 'confirm' ? t('confirmTitle') : t('alertTitle'))
      const content = opts.message || ''
      const okText = opts.confirmText || (type === 'confirm' ? t('confirm') : t('ok'))
      const cancelText = opts.cancelText || (type === 'confirm' ? t('cancel') : undefined)
      const isDanger = opts.confirmVariant === 'danger'

      const promise = new Promise<boolean>((resolvePromise) => {
        resolverRef.current = resolvePromise
      })

      if (type === 'confirm') {
        modal.confirm({
          title,
          content,
          okText,
          cancelText,
          okButtonProps: isDanger ? { danger: true } : undefined,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      } else {
        modal.info({
          title,
          content,
          okText,
          onOk: () => resolve(true),
        })
      }

      return promise
    },
    [modal, t],
  )

  const confirm = useCallback(
    (options: DialogOptions) => open(options, 'confirm'),
    [open],
  )
  const alert = useCallback(
    (options: DialogOptions) => open(options, 'alert'),
    [open],
  )

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
    </DialogContext.Provider>
  )
}
