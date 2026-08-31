"use client"

import { createContext, useState, useEffect, useCallback } from 'react'
import type { AuthState, DispatcherUser } from '@/lib/types/user'
import { supabase } from '@/lib/supabase/client'
import { api } from '@/lib/api/client'
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout'
import { clearActivity, recordActivity } from '@shared/lib/session/idle'

export const AuthContext = createContext<AuthState | null>(null)

/**
 * The credentials were accepted but the dispatcher profile behind them would not load.
 *
 * Separate from a credential failure because the two are not the user's problem in the
 * same way: one is a typo they can fix, the other is the backend being unreachable, and
 * telling them "invalid credentials" for the second sends them retyping a correct
 * password. The login form distinguishes the two on this type.
 */
export class ProfileUnavailableError extends Error {
  override readonly name = 'ProfileUnavailableError'

  constructor() {
    super('Signed in, but your dispatcher profile could not be loaded. Please try again.')
  }
}

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
    try {
      const { error } = await supabase.auth.signInWithPassword(credentials)
      if (error) throw error
      // Start the idle clock at the sign-in itself. Without this the first stored activity
      // would be whatever the user happened to click next, and a session left untouched
      // immediately after signing in would inherit a stale timestamp from a PREVIOUS
      // session — expiring far too early, or on a fresh profile not at all.
      recordActivity(window.localStorage)
      // The profile is loaded HERE, not left to the SIGNED_IN listener above, and this
      // function does not resolve until it has landed.
      //
      // signInWithPassword resolving only means the CREDENTIALS were accepted; `user` is
      // still a round trip away. The caller navigates the moment we return, and the route
      // guard reads "finished loading, still no user" as signed-out — so returning early
      // bounced the dispatcher straight back to /login, and every sign-in took two
      // attempts. Awaiting it here means the guard already agrees by the time we return.
      const profile = await fetchProfile()
      if (!profile) throw new ProfileUnavailableError()
      setUser(profile)
    } finally {
      // In a finally so a failure cannot strand the form in its loading state.
      setIsLoading(false)
    }
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    // Clear before the state update so any other tab's storage listener sees a signed-out
    // machine rather than a live timestamp with no session behind it.
    clearActivity(window.localStorage)
    setUser(null)
  }, [])

  // The inactivity timeout. Armed only while signed in, so the login page carries no
  // timer. Signing out here is the same path as the button — the SIGNED_OUT event it
  // fires is what the route guard reacts to.
  useIdleTimeout(user !== null, signOut)

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
