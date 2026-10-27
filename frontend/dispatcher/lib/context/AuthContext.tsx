"use client"

import { createContext, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import type { AuthState, DispatcherUser } from '@/lib/types/user'
import type { PasswordAuthPort } from '@shared/lib/auth/port'
import { supabasePasswordAuth } from '@/lib/auth/SupabasePasswordAuth'
import { api } from '@/lib/api/client'
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout'
import { clearActivity, recordActivity } from '@shared/lib/session/idle'
import { clearReturnPath, saveReturnPath } from '@shared/lib/session/return-path'
import { clearSessionCaches } from '@/lib/cache/sessionCache'
import { ROUTES } from '@/lib/constants/routes'

export const AuthContext = createContext<AuthState | null>(null)

const AUTH_ROUTE_PREFIXES = [ROUTES.login]

export const SUPPRESS_RETURN_SAVE_KEY = 'fp:suppress-return-save'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Credentials were accepted but the profile behind them wouldn't load — distinct from a
 *  credential failure so the login form doesn't tell the user to retype a correct password. */
export class ProfileUnavailableError extends Error {
  override readonly name = 'ProfileUnavailableError'

  constructor() {
    super('Signed in, but your dispatcher profile could not be loaded. Please try again.')
  }
}

interface AuthProviderProps {
  children: React.ReactNode
  port?: PasswordAuthPort
}

export function AuthProvider({ children, port = supabasePasswordAuth }: AuthProviderProps) {
  const [user, setUser] = useState<DispatcherUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const signInWillLoadProfile = useRef(false)
  const cachedIdentity = useRef<string | null>(null)

  const fetchProfile = useCallback(async (): Promise<DispatcherUser | null> => {
    try {
      return await api.get<DispatcherUser>('/api/v1/auth/me')
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let active = true

    port.getSession().then(async session => {
      if (!active) return
      if (session) {
        const profile = await fetchProfile()
        if (active && profile) setUser(profile)
      }
      if (active) setIsLoading(false)
    })

    const unsubscribe = port.onChange((event, session) => {
      if (!active) return

      if (event === 'signed_out' || !session) {
        setUser(null)
        return
      }

      if (event === 'signed_in') {
        if (signInWillLoadProfile.current) {
          signInWillLoadProfile.current = false
          return
        }
        setTimeout(async () => {
          const profile = await fetchProfile()
          if (active && profile) setUser(profile)
        }, 0)
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [fetchProfile, port])

  const signIn = useCallback(async (credentials: { email: string; password: string }) => {
    setIsLoading(true)
    signInWillLoadProfile.current = true
    try {
      await port.signInWithPassword(credentials)
      recordActivity(window.localStorage)
      const profile = await fetchProfile()
      if (!profile) throw new ProfileUnavailableError()
      setUser(profile)
    } catch (err) {
      signInWillLoadProfile.current = false
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [fetchProfile, port])

  const performSignOut = useCallback(async () => {
    try {
      await port.signOut()
    } catch (error) {
      console.error('AuthContext: sign-out call failed; clearing the local session anyway', error)
    }
    clearActivity(window.localStorage)
    setUser(null)
  }, [port])

  const signOut = useCallback(async () => {
    await performSignOut()
    clearReturnPath(window.localStorage)
    try {
      sessionStorage.setItem(SUPPRESS_RETURN_SAVE_KEY, '1')
    } catch {
    }
  }, [performSignOut])

  const handleIdleExpiry = useCallback(() => {
    saveReturnPath(
      window.localStorage,
      window.location.pathname + window.location.search,
      AUTH_ROUTE_PREFIXES,
    )
    void performSignOut()
  }, [performSignOut])

  useIsomorphicLayoutEffect(() => {
    const identity = user?.id ?? null
    if (cachedIdentity.current === identity) return
    cachedIdentity.current = identity
    clearSessionCaches()
  }, [user?.id])

  useIdleTimeout(user !== null, handleIdleExpiry)

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
