"use client"

import { createContext, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import type { AuthState, DispatcherUser } from '@/lib/types/user'
import { supabase } from '@/lib/supabase/client'
import { api } from '@/lib/api/client'
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout'
import { clearActivity, recordActivity } from '@shared/lib/session/idle'
import { clearReturnPath, saveReturnPath } from '@shared/lib/session/return-path'
import { clearSessionCaches } from '@/lib/cache/sessionCache'
import { ROUTES } from '@/lib/constants/routes'

export const AuthContext = createContext<AuthState | null>(null)

// Routes a saved return path must never point back into.
const AUTH_ROUTE_PREFIXES = [ROUTES.login]

// One-shot marker consumed by the guarded layout's own redirect effect (see
// app/(app)/layout.tsx). A manual sign-out below already decided to clear the return
// path; without this, the layout's effect reacting to the same user -> null transition
// moments later would immediately re-save the page the dispatcher just deliberately
// left. sessionStorage, not localStorage: it only needs to outlive this tab's own
// redirect, not a fresh session. Exported for the layout only.
export const SUPPRESS_RETURN_SAVE_KEY = 'fp:suppress-return-save'

// Runs before paint, unlike useEffect: an identity change must not leave the previous
// dispatcher's records on screen for even one frame. Falls back to useEffect on the
// server, where useLayoutEffect only warns.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Credentials were accepted but the profile behind them wouldn't load — distinct from a
 *  credential failure so the login form doesn't tell the user to retype a correct password. */
export class ProfileUnavailableError extends Error {
  override readonly name = 'ProfileUnavailableError'

  constructor() {
    super('Signed in, but your dispatcher profile could not be loaded. Please try again.')
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DispatcherUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // Claimed by signIn so the SIGNED_IN listener below doesn't double-fetch /auth/me for
  // the same login; handles both orderings of when Supabase raises the event.
  const signInWillLoadProfile = useRef(false)
  // Identity the client-side caches currently hold records for. Starts null so a fresh
  // tab always begins from an empty cache, including paths that never raise SIGNED_OUT.
  const cachedIdentity = useRef<string | null>(null)

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
        // Only adopt a successfully-loaded profile — a transient fetch failure shouldn't
        // null out an otherwise-valid session.
        if (active && profile) setUser(profile)
      }
      if (active) setIsLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return

      // Missing session = genuinely unauthenticated. The ONLY path that clears the user.
      if (event === 'SIGNED_OUT' || !session) {
        setUser(null)
        return
      }

      // Only a fresh sign-in needs a profile load; re-fetching on TOKEN_REFRESHED /
      // USER_UPDATED / INITIAL_SESSION was bouncing authenticated users to /login after
      // an idle tab on a transient /auth/me failure.
      if (event === 'SIGNED_IN') {
        if (signInWillLoadProfile.current) {
          // Our own signIn raised this and is already loading the profile; release the
          // claim so a later, non-signIn sign-in still gets fetched here.
          signInWillLoadProfile.current = false
          return
        }
        // Defer outside this callback: Supabase holds its auth lock while running
        // onAuthStateChange, so awaiting here would keep it held.
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
    signInWillLoadProfile.current = true
    try {
      const { error } = await supabase.auth.signInWithPassword(credentials)
      if (error) throw error
      // Start the idle clock at sign-in itself, or a session left untouched would inherit
      // a stale timestamp from a previous session.
      recordActivity(window.localStorage)
      // Loaded HERE, not left to the SIGNED_IN listener: the caller navigates the moment
      // we return, and the route guard would otherwise read "no user yet" as signed-out
      // and bounce back to /login.
      const profile = await fetchProfile()
      if (!profile) throw new ProfileUnavailableError()
      setUser(profile)
    } catch (err) {
      // Not in `finally`: on success the listener may not have run yet and clearing the
      // claim early would let its duplicate fetch back in.
      signInWillLoadProfile.current = false
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [fetchProfile])

  // The actual exit mechanics, shared by both ways a session ends below. Deliberately
  // silent on the return path — callers decide that, since a manual sign-out and an idle
  // expiry want opposite outcomes for it.
  const performSignOut = useCallback(async () => {
    await supabase.auth.signOut()
    // Clear before the state update so another tab's storage listener sees a signed-out
    // machine, not a live timestamp with no session behind it.
    clearActivity(window.localStorage)
    setUser(null)
  }, [])

  // Manual sign-out (Settings > Sign out): clears any saved return path — a dispatcher
  // who deliberately leaves a screen should not be dropped back onto it next time they
  // sign in.
  const signOut = useCallback(async () => {
    await performSignOut()
    clearReturnPath(window.localStorage)
    try {
      sessionStorage.setItem(SUPPRESS_RETURN_SAVE_KEY, '1')
    } catch {
      // Worst case the layout's guard saves a path anyway — degraded, not broken.
    }
  }, [performSignOut])

  // Idle expiry: the one sign-out path that SHOULD resurrect the dispatcher's screen,
  // since unlike signOut() above they never chose to leave it. Save first, then run the
  // same exit mechanics via performSignOut — NOT the public signOut, which would
  // immediately clear what was just saved.
  const handleIdleExpiry = useCallback(() => {
    saveReturnPath(
      window.localStorage,
      window.location.pathname + window.location.search,
      AUTH_ROUTE_PREFIXES,
    )
    void performSignOut()
  }, [performSignOut])

  // Module-scope caches survive a sign-out (no page reload), so clear them on any
  // identity change — not just sign-out, since another tab signing in also replaces the
  // identity without ever passing through null.
  useIsomorphicLayoutEffect(() => {
    const identity = user?.id ?? null
    if (cachedIdentity.current === identity) return
    cachedIdentity.current = identity
    clearSessionCaches()
  }, [user?.id])

  // Armed only while signed in, so the login page carries no timer.
  useIdleTimeout(user !== null, handleIdleExpiry)

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
