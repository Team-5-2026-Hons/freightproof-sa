"use client"

import { createContext, useState, useEffect, useCallback, useRef } from 'react'
import type { AuthState, DriverUser } from '@/lib/types/user'
import type { OtpAuthPort } from '@shared/lib/auth/port'
import { defaultOtpAuth, defaultProfileSource } from '@/lib/auth/defaults'
import type { DriverProfileSource } from '@/lib/auth/DriverProfileSource'
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout'
import { clearActivity, recordActivity } from '@shared/lib/session/idle'
import { clearReturnPath, saveReturnPath } from '@shared/lib/session/return-path'
import { ROUTES } from '@/lib/constants/routes'

// Which backend proves identity and where the profile comes from is injected (see
// AuthProviderProps): demo mode (default) wires a mock OTP flow and a fixture driver, real
// mode a Supabase phone OTP and the backend's own driver profile. This provider owns only
// the session state machine around them.

// Routes a saved return path must never point back into. '/otp' isn't in ROUTES (see
// app/login/page.tsx, which hardcodes it the same way) — there is nowhere useful to
// return a driver to mid-OTP-exchange.
const AUTH_ROUTE_PREFIXES = [ROUTES.login, '/otp']

// One-shot marker consumed by the guarded layout's own redirect effect (see
// app/(app)/layout.tsx). A manual sign-out below already decided to clear the return
// path; without this, the layout's effect reacting to the same user -> null transition
// moments later would immediately re-save the page the driver just deliberately left.
// sessionStorage, not localStorage: it only needs to outlive this tab's own redirect, not
// a fresh session. Exported for the layout only.
export const SUPPRESS_RETURN_SAVE_KEY = 'fp:suppress-return-save'

// Re-exported so existing importers (tests) keep their path; it now belongs to the demo adapter.
export { DEMO_SESSION_KEY } from '@/lib/auth/DemoOtpAuth'

export const AuthContext = createContext<AuthState | null>(null)

interface AuthProviderProps {
  children: React.ReactNode
  /** Proves who is signed in. Defaults to the demo or Supabase adapter per IS_DEMO_MODE. */
  port?: OtpAuthPort
  /** Loads the signed-in driver's profile. Defaults to the demo fixture or the backend API. */
  profiles?: DriverProfileSource
}

export function AuthProvider({ children, port: injectedPort, profiles: injectedProfiles }: AuthProviderProps) {
  // Defaults are resolved here, lazily, and are stable across renders (see defaults.ts).
  const port = injectedPort ?? defaultOtpAuth()
  const profiles = injectedProfiles ?? defaultProfileSource()
  const [user, setUser] = useState<DriverUser | null>(null)
  // Starts true in both modes so guarded routes wait for session restoration
  // (the port's getSession, then the profile load) instead of flashing to /login on
  // refresh. It only turns false after BOTH have settled, which is what keeps the login
  // screen from rendering in the gap while an async restore is in flight.
  const [isLoading, setIsLoading] = useState(true)

  // Tracks the currently-loaded driver id outside React state so the
  // onAuthStateChange listener (subscribed once, see below) can compare
  // against it without needing `user` in its dependency array.
  const userIdRef = useRef<string | null>(null)
  useEffect(() => {
    userIdRef.current = user ? String(user.id) : null
  }, [user])

  const fetchProfile = useCallback(() => profiles.loadProfile(), [profiles])

  // On app load, restore a session if one exists (a page refresh, or a demo walkthrough
  // the tab already started) and keep following the port's session changes.
  useEffect(() => {
    let active = true

    port.getSession().then(async session => {
      if (session) {
        const profile = await fetchProfile()
        if (active) setUser(profile)
      }
      if (active) setIsLoading(false)
    })

    const unsubscribe = port.onChange(async (_event, session) => {
      if (!session) {
        setUser(null)
        return
      }
      // The backend can re-fire SIGNED_IN/INITIAL_SESSION for a session that hasn't
      // actually changed (e.g. its own tab-visibility/multi-tab sync) — only refetch
      // the driver profile when the signed-in identity is actually different.
      // Otherwise this creates a new `user` object every time, which cascades into
      // every consumer keyed on it by reference (e.g. TripContext refetching the
      // active trip and toggling isLoading on a loop, blanking the page).
      if (session.userId === userIdRef.current) return
      setUser(await fetchProfile())
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [port, fetchProfile])

  const requestOtp = useCallback(async (phone_number: string) => {
    setIsLoading(true)
    try {
      await port.requestOtp(phone_number)
    } finally {
      setIsLoading(false)
    }
  }, [port])

  const signIn = useCallback(async (credentials: { phone_number: string; otp: string }) => {
    setIsLoading(true)

    try {
      await port.verifyOtp(credentials.phone_number, credentials.otp)
    } catch (err) {
      setIsLoading(false)
      throw err
    }

    // Start the idle clock at the sign-in itself — see the dispatcher's AuthContext for
    // why the first activity stamp cannot be left to the driver's next tap.
    recordActivity(window.localStorage)
    setUser(await fetchProfile())
    setIsLoading(false)
  }, [port, fetchProfile])

  // The actual exit mechanics, shared by both ways a session ends below. Deliberately
  // silent on the return path — callers decide that, since a manual sign-out and an idle
  // expiry want opposite outcomes for it.
  const performSignOut = useCallback(async () => {
    await port.signOut()
    clearActivity(window.localStorage)
    setUser(null)
  }, [port])

  // Manual sign-out (the profile panel's "Log out"): clears any saved return path — a
  // driver who deliberately leaves a screen should not be dropped back onto it next time
  // they sign in.
  const signOut = useCallback(async () => {
    await performSignOut()
    clearReturnPath(window.localStorage)
    try {
      sessionStorage.setItem(SUPPRESS_RETURN_SAVE_KEY, '1')
    } catch {
      // Worst case the layout's guard saves a path anyway — degraded, not broken.
    }
  }, [performSignOut])

  // Idle expiry: the one sign-out path that SHOULD resurrect the driver's screen, since
  // unlike signOut() above they never chose to leave it. Save first, then run the same
  // exit mechanics via performSignOut — NOT the public signOut, which would immediately
  // clear what was just saved.
  const handleIdleExpiry = useCallback(() => {
    saveReturnPath(
      window.localStorage,
      window.location.pathname + window.location.search,
      AUTH_ROUTE_PREFIXES,
    )
    void performSignOut()
  }, [performSignOut])

  // The inactivity timeout, armed only while signed in. Applies in demo mode too: the
  // walkthrough should behave like the real app, and the port's signOut handles both.
  useIdleTimeout(user !== null, handleIdleExpiry)

  return (
    <AuthContext.Provider value={{ user, isLoading, requestOtp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
