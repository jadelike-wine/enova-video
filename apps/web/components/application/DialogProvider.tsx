'use client'

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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

const iconMap: Record<DialogState['type'], string> = {
  confirm: '⚠️',
  alert: '💡',
}

const variantClass: Record<'primary' | 'danger', string> = {
  primary: 'btn-primary',
  danger: 'btn-danger',
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('dialog')
  const [state, setState] = useState<DialogState>({
    visible: false,
    type: 'confirm',
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    confirmVariant: 'primary',
  })
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const open = useCallback(
    (options: DialogOptions, type: DialogState['type']) => {
      const opts = typeof options === 'string' ? { message: options } : options
      setState({
        visible: true,
        type,
        title: opts.title || (type === 'confirm' ? t('confirmTitle') : t('alertTitle')),
        message: opts.message || '',
        confirmText: opts.confirmText || (type === 'confirm' ? t('confirm') : t('ok')),
        cancelText: opts.cancelText || (type === 'confirm' ? t('cancel') : ''),
        confirmVariant: opts.confirmVariant || 'primary',
      })
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
      })
    },
    [t],
  )

  const confirm = useCallback(
    (options: DialogOptions) => open(options, 'confirm'),
    [open],
  )
  const alert = useCallback(
    (options: DialogOptions) => open(options, 'alert'),
    [open],
  )

  const handleConfirm = useCallback(() => {
    setState((s) => ({ ...s, visible: false }))
    resolverRef.current?.(true)
    resolverRef.current = null
  }, [])

  const handleCancel = useCallback(() => {
    setState((s) => ({ ...s, visible: false }))
    resolverRef.current?.(false)
    resolverRef.current = null
  }, [])

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state.visible && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={() =>
            state.type === 'confirm' ? handleCancel() : handleConfirm()
          }
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md glass-strong rounded-3xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500/30 to-cyan-400/30 flex items-center justify-center text-2xl flex-shrink-0 border border-gray-200">
                {iconMap[state.type] || '💬'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-gray-900 mb-2">{state.title}</h3>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {state.message}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              {state.type === 'confirm' && (
                <button onClick={handleCancel} className="btn-ghost px-6">
                  {state.cancelText}
                </button>
              )}
              <button
                onClick={handleConfirm}
                className={`${variantClass[state.confirmVariant] || 'btn-primary'} px-6`}
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}