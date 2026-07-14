import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, DEMO_SESSION_KEY } from '@/lib/context/AuthContext'
import { useAuth } from '@/lib/hooks/useAuth'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))

describe('AuthContext (demo mode)', () => {
  beforeEach(() => {
    // The demo session flag persists across provider mounts — isolate tests.
    sessionStorage.clear()
  })

  it('signIn sets the mock driver and signOut clears it', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })
    expect(result.current.user).not.toBeNull()

    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.user).toBeNull()
  })

  it('requestOtp resolves without throwing', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    // Awaiting act() directly (not via expect().resolves) — wrapping React's
    // act thenable in another promise chain leaves the act scope open and
    // breaks every renderHook that runs after this test. A rejection here
    // still fails the test, so "resolves without throwing" is preserved.
    await act(async () => {
      await result.current.requestOtp('+27821234567')
    })
  })

  it('signIn persists the demo session flag to sessionStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })

    expect(sessionStorage.getItem(DEMO_SESSION_KEY)).toBe('true')
  })

  it('a fresh mount with the session flag set hydrates the demo user without signIn', () => {
    sessionStorage.setItem(DEMO_SESSION_KEY, 'true')

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    // User is restored and loading has resolved — guarded routes must not
    // bounce a refreshed demo session back to /login.
    expect(result.current.user).not.toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('a fresh mount without the flag resolves loading with no user', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(result.current.user).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('signOut removes the demo session flag', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })

    await act(async () => {
      await result.current.signOut()
    })

    expect(sessionStorage.getItem(DEMO_SESSION_KEY)).toBeNull()
  })
})
