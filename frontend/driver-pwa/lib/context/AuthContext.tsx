"use client"

import { createContext, useState, useEffect, useCallback, useRef } from 'react'
import type { AuthState, DriverUser } from '@/lib/types/user'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api/client'
import { IS_DEMO_MODE } from '@/lib/constants/env'

// Demo mode (default) drives auth from a mock OTP flow with a fixture driver.
// Real mode exchanges a Supabase phone OTP for a session, then fetches the
// driver's own profile from the backend — the Driver row whose id equals the
// Supabase auth user's UUID.
const MOCK_DRIVER: DriverUser = mockDrivers[0]

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DriverUser | null>(null)
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)

  // Tracks the currently-loaded driver id outside React state so the
  // onAuthStateChange listener (subscribed once, see below) can compare
  // against it without needing `user` in its dependency array.
  const userIdRef = useRef<string | null>(null)
  useEffect(() => {
    userIdRef.current = user ? String(user.id) : null
  }, [user])

  const fetchProfile = useCallback(async (): Promise<DriverUser | null> => {
    try {
      return await api.get<DriverUser>('/api/v1/drivers/me')
    } catch (err) {
      // Logged so a backend 500/network failure here is distinguishable from a
      // driver whose phone simply isn't provisioned yet — both currently end up
      // with user = null, but only one of them should be silent.
      console.error('Failed to fetch driver profile', err)
      return null
    }
  }, [])

  // On app load, check whether a Supabase session already exists (e.g. page refresh).
  useEffect(() => {
    if (IS_DEMO_MODE) return

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(await fetchProfile())
      }
      setIsLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        setUser(null)
        return
      }
      // Supabase can re-fire SIGNED_IN/INITIAL_SESSION for a session that hasn't
      // actually changed (e.g. its own tab-visibility/multi-tab sync) — only refetch
      // the driver profile when the signed-in identity is actually different.
      // Otherwise this creates a new `user` object every time, which cascades into
      // every consumer keyed on it by reference (e.g. TripContext refetching the
      // active trip and toggling isLoading on a loop, blanking the page).
      if (session.user.id === userIdRef.current) return
      setUser(await fetchProfile())
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const requestOtp = useCallback(async (phone_number: string) => {
    setIsLoading(true)

    if (IS_DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 600))
      setIsLoading(false)
      return
    }

    // shouldCreateUser: false blocks unregistered phone numbers — a driver
    // auth account only exists if a dispatcher provisioned it via /drivers.
    // channel: 'whatsapp' — Twilio's WhatsApp Sandbox for dev/testing, since SMS
    // requires Twilio geo permissions + A2P 10DLC registration we haven't set up
    // for South African destinations yet. Switch back to 'sms' once that's done.
    const { error } = await supabase.auth.signInWithOtp({
      phone: phone_number,
      options: { channel: 'whatsapp', shouldCreateUser: false },
    })
    setIsLoading(false)
    if (error) throw error
  }, [])

  const signIn = useCallback(async (credentials: { phone_number: string; otp: string }) => {
    setIsLoading(true)

    if (IS_DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 600))
      setUser(MOCK_DRIVER)
      setIsLoading(false)
      return
    }

    const { error } = await supabase.auth.verifyOtp({
      phone: credentials.phone_number,
      token: credentials.otp,
      type: 'sms',
    })
    if (error) {
      setIsLoading(false)
      throw error
    }

    setUser(await fetchProfile())
    setIsLoading(false)
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    if (!IS_DEMO_MODE) {
      await supabase.auth.signOut()
    }
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, requestOtp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
