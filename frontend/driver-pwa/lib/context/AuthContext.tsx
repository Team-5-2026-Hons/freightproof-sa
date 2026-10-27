"use client"

import { createContext, useState, useEffect, useCallback } from 'react'
import type { AuthState, DriverUser } from '@/lib/types/user'
import type { OtpAuthPort } from '@shared/lib/auth/port'
import { defaultOtpAuth, defaultProfileSource } from '@/lib/auth/defaults'
import { isProfileUnreachable } from '@/lib/auth/DriverProfileSource'
import type { DriverProfileSource } from '@/lib/auth/DriverProfileSource'
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout'
import { clearActivity, recordActivity } from '@shared/lib/session/idle'
import { clearReturnPath, saveReturnPath } from '@shared/lib/session/return-path'
import { ROUTES } from '@/lib/constants/routes'
import { actorGeneration, bindActorLease, captureActorLease, invalidateActorLease, observeAuthSession } from '@/lib/session/custody-context'

const AUTH_ROUTE_PREFIXES = [ROUTES.login, '/otp']

export const SUPPRESS_RETURN_SAVE_KEY = 'fp:suppress-return-save'

export const AuthContext = createContext<AuthState | null>(null)

interface AuthProviderProps {
  children: React.ReactNode
  port?: OtpAuthPort
  profiles?: DriverProfileSource
}

export function AuthProvider({ children, port: injectedPort, profiles: injectedProfiles }: AuthProviderProps) {
  const port = injectedPort ?? defaultOtpAuth()
  const profiles = injectedProfiles ?? defaultProfileSource()
  const [user, setUser] = useState<DriverUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [connectionFault, setConnectionFault] = useState(false)

  const fetchProfile = useCallback(() => profiles.loadProfile(), [profiles])

  useEffect(() => {
    let active = true
    let revision = 0
    let loadedSubject: string | null = null

    const restore = async (session: { userId: string } | null): Promise<void> => {
      const requestRevision = ++revision
      const generation = observeAuthSession(session?.userId ?? null)
      if (!session) {
        invalidateActorLease()
        loadedSubject = null
        if (active) { setUser(null); setIsLoading(false) }
        return
      }
      if (loadedSubject === session.userId && captureActorLease() !== null) return
      const result = await fetchProfile()
      if (!active || revision !== requestRevision || actorGeneration() !== generation) return
      if (isProfileUnreachable(result)) {
        setConnectionFault(true)
        setIsLoading(false)
        return
      }
      const profile = result
      if (profile !== null && !bindActorLease(String(profile.id), generation)) return
      setConnectionFault(false)
      loadedSubject = session.userId
      setUser(profile)
      setIsLoading(false)
    }

    const startRevision = revision
    const startupGeneration = actorGeneration()
    port.getSession().then(async session => {
      if (active && revision === startRevision && actorGeneration() === startupGeneration) await restore(session)
    }).catch((err: unknown) => {
      console.error('AuthContext: session restore failed', err)
      if (active) setIsLoading(false)
    })

    const unsubscribe = port.onChange(async (_event, session) => {
      try { await restore(session) } catch (err: unknown) {
        console.error('AuthContext: profile restore failed', err)
        if (active) setIsLoading(false)
      }
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

    recordActivity(window.localStorage)
    const sessionGeneration = actorGeneration()
    const session = await port.getSession()
    if (actorGeneration() !== sessionGeneration) return
    if (session === null) { setIsLoading(false); return }
    const generation = observeAuthSession(session?.userId ?? null)
    const result = await fetchProfile()
    if (isProfileUnreachable(result)) {
      setConnectionFault(true)
      setIsLoading(false)
      return
    }
    setConnectionFault(false)
    if (result !== null && bindActorLease(String(result.id), generation)) setUser(result)
    setIsLoading(false)
  }, [port, fetchProfile])

  const retryProfile = useCallback(async () => {
    setConnectionFault(false)
    setIsLoading(true)
    try {
      const session = await port.getSession()
      if (session === null) { setIsLoading(false); return }
      const generation = observeAuthSession(session.userId)
      const result = await fetchProfile()
      if (isProfileUnreachable(result)) {
        setConnectionFault(true)
        return
      }
      if (result !== null && bindActorLease(String(result.id), generation)) setUser(result)
    } catch (err: unknown) {
      console.error('AuthContext: profile retry failed', err)
      setConnectionFault(true)
    } finally {
      setIsLoading(false)
    }
  }, [port, fetchProfile])

  const performSignOut = useCallback(async () => {
    invalidateActorLease()
    setConnectionFault(false)
    await port.signOut()
    clearActivity(window.localStorage)
    setUser(null)
    setIsLoading(false)
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

  useIdleTimeout(user !== null, handleIdleExpiry)

  return (
    <AuthContext.Provider value={{ user, isLoading, connectionFault, retryProfile, requestOtp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
