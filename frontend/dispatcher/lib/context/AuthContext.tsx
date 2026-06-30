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
    let active = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return
      if (session) {
        const profile = await fetchProfile()
        // Only adopt a successfully-loaded profile. If the fetch failed transiently we
        // still have a valid session, so don't null the user out of an authenticated state.
        if (active && profile) setUser(profile)
      }
      if (active) setIsLoading(false)
    })

    // Listen for Supabase Auth state changes (login, logout, token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return

      // A missing session means genuinely unauthenticated: explicit sign-out, or the
      // refresh token is no longer valid. This is the ONLY path that clears the user.
      if (event === 'SIGNED_OUT' || !session) {
        setUser(null)
        return
      }

      // A fresh sign-in (e.g. via the login form) is the only event that needs to load
      // the profile. TOKEN_REFRESHED / USER_UPDATED / INITIAL_SESSION all carry a valid
      // session for the SAME user — re-fetching the profile there (and nulling it on a
      // transient /auth/me failure) is what was bouncing authenticated users to /login
      // after an idle tab. So we deliberately keep the current user on those events.
      if (event === 'SIGNED_IN') {
        // Defer the profile fetch outside this callback. Supabase runs onAuthStateChange
        // *while holding its auth lock*, so any awaited work here would keep the lock held;
        // setTimeout(…, 0) lets the callback return and the lock release first.
        setTimeout(async () => {
          const profile = await fetchProfile()
          if (active && profile) setUser(profile)
        }, 0)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
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
