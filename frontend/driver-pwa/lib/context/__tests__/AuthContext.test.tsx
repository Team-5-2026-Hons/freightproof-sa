import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, DEMO_SESSION_KEY, SUPPRESS_RETURN_SAVE_KEY } from '@/lib/context/AuthContext'
import { useAuth } from '@/lib/hooks/useAuth'
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout'
import { RETURN_PATH_KEY } from '@shared/lib/session/return-path'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))
// The idle timer itself (listeners, a real setTimeout, cross-tab sync) is wiring these
// tests aren't about — see useIdleTimeout.ts, which is tested separately via idle.ts.
// Mocking it also lets a test fire the expiry handler directly instead of waiting out the
// real ten-minute window.
vi.mock('@/lib/hooks/useIdleTimeout', () => ({ useIdleTimeout: vi.fn() }))

const mockedUseIdleTimeout = vi.mocked(useIdleTimeout)

/** The onExpire handler AuthProvider most recently armed the (mocked) idle timer with. */
function latestIdleExpiryHandler(): (() => void) | undefined {
  return mockedUseIdleTimeout.mock.calls.at(-1)?.[1]
}

describe('AuthContext (demo mode)', () => {
  beforeEach(() => {
    // The demo session flag persists across provider mounts — isolate tests.
    sessionStorage.clear()
    localStorage.clear()
    mockedUseIdleTimeout.mockClear()
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

describe('return path around idle expiry vs manual sign-out', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    mockedUseIdleTimeout.mockClear()
    // A page with a query string — the id rides in one, per driver-pwa's `output: export`
    // route scheme, so the round trip has to preserve it.
    window.history.pushState({}, '', '/trips/detail?id=abc-123')
  })

  async function signInAsDriver(result: { current: ReturnType<typeof useAuth> }) {
    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })
  }

  it('idle expiry saves the current path, then signs out', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await signInAsDriver(result)

    const onExpire = latestIdleExpiryHandler()
    expect(onExpire).toBeInstanceOf(Function)

    await act(async () => {
      onExpire?.()
      // performSignOut has no real await in demo mode, but flush anyway so this doesn't
      // silently start relying on that.
      await Promise.resolve()
    })

    expect(localStorage.getItem(RETURN_PATH_KEY)).toBe('/trips/detail?id=abc-123')
    expect(result.current.user).toBeNull()
  })

  it('manual sign-out clears a previously saved return path instead of setting one', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await signInAsDriver(result)
    // Simulate a path left over from an earlier idle expiry this same browser saw.
    localStorage.setItem(RETURN_PATH_KEY, '/trips/detail?id=abc-123')

    await act(async () => {
      await result.current.signOut()
    })

    expect(localStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })

  it('manual sign-out marks the suppress key so the guarded layout will not re-save it', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await signInAsDriver(result)

    await act(async () => {
      await result.current.signOut()
    })

    expect(sessionStorage.getItem(SUPPRESS_RETURN_SAVE_KEY)).toBe('1')
  })

  it('idle expiry does NOT mark the suppress key — the layout re-saving the same path is harmless', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await signInAsDriver(result)

    const onExpire = latestIdleExpiryHandler()
    await act(async () => {
      onExpire?.()
      await Promise.resolve()
    })

    expect(sessionStorage.getItem(SUPPRESS_RETURN_SAVE_KEY)).toBeNull()
  })
})
