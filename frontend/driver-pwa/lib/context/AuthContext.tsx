"use client"

import { createContext, useState, useCallback } from 'react'
import type { AuthState, DriverUser } from '@/lib/types/user'
import { mockDrivers } from '@shared/lib/mocks/drivers'

// On sign-in the driver app sets the first driver in the fixtures.
// The real implementation exchanges a phone OTP for a JWT and returns the Driver record.
const MOCK_DRIVER: DriverUser = mockDrivers[0]

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DriverUser | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const requestOtp = useCallback(async (_phone_number: string) => {
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 600))
    setIsLoading(false)
  }, [])

  const signIn = useCallback(async (_credentials: { phone_number: string; otp: string }) => {
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 600))
    setUser(MOCK_DRIVER)
    setIsLoading(false)
  }, [])

  const signOut = useCallback(async () => {
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, requestOtp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
