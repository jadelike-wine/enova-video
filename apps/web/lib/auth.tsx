'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { authApi, billingApi, type AuthResult } from './api'

export interface SessionState {
  loading: boolean
  user: AuthResult['user'] | null
  balance: number
  reservedBalance: number
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthResult['user'] | null>(null)
  const [balance, setBalance] = useState(0)
  const [reservedBalance, setReservedBalance] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me()
      setUser(me.user)
      setBalance(me.balance)
      setReservedBalance(me.reservedBalance)
    } catch {
      setUser(null)
      setBalance(0)
      setReservedBalance(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      setBalance(0)
      setReservedBalance(0)
      router.replace('/auth/login')
    }
  }, [router])

  const value = useMemo<SessionState>(
    () => ({ loading, user, balance, reservedBalance, refresh, logout }),
    [loading, user, balance, reservedBalance, refresh, logout],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}

/** 刷新钱包余额（生成任务结算/充值后调用）。 */
export async function refreshWallet(): Promise<{ balance: number; reservedBalance: number }> {
  return billingApi.wallet()
}

export { SessionContext }