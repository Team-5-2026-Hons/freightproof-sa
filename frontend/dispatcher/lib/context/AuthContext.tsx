"use client"

import { createContext, useState, useEffect, useCallback } from 'react'
import type { AuthState, DispatcherUser } from '@/lib/types/user'
import { supabase } from '@/lib/supabase/client'
import { api } from '@/lib/api/client'

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DispatcherUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchProfile = useCallback(async (): Promise<DispatcherUser | null> => {
    try {
      return await api.get<DispatcherUser>('/api/v1/auth/me')
    } catch {
      return null
    }
  }, [])

  // On app load, check if a session already exists (e.g. user refreshed the page).
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const profile = await fetchProfile()
        setUser(profile)
      }
      setIsLoading(false)
    })

    // Listen for Supabase Auth state changes (login, logout, token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const profile = await fetchProfile()
        setUser(profile)
      } else {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const signIn = useCallback(async (credentials: { email: string; password: string }) => {
    setIsLoading(true)
    const { error } = await supabase.auth.signInWithPassword(credentials)
    setIsLoading(false)
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
