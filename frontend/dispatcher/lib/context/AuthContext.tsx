"use client"

import { createContext, useState, useCallback } from 'react'
import type { AuthState, DispatcherUser, UserId } from '@/lib/types/user'
import { OPERATOR_ORG_ID } from '@shared/lib/mocks/principals'

const MOCK_DISPATCHER: DispatcherUser = {
  id: 'usr-disp-00000001-0000-4000-8000-000000000001' as unknown as UserId,
  organization_id: OPERATOR_ORG_ID,
  email: 'dispatcher@linbroexpress.co.za',
  full_name: 'Demo Dispatcher',
  is_active: true,
}

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DispatcherUser | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const signIn = useCallback(async (_credentials: { email: string; password: string }) => {
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 600))
    setUser(MOCK_DISPATCHER)
    setIsLoading(false)
  }, [])

  const signOut = useCallback(async () => {
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
