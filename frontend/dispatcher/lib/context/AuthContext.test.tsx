/**
 * The sign-in handshake, from the route guard's point of view.
 *
 * app/(app)/layout.tsx admits a dispatcher on `!isLoading && user`, and bounces to
 * /login on `!isLoading && !user`. Those two facts are set by different awaits, so the
 * only thing that keeps the guard honest is that signIn does not resolve — and the login
 * page does not navigate — until both are settled. That is what these tests hold down.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import { supabase } from '@/lib/supabase/client'
import type { DispatcherUser } from '@/lib/types/user'
import { clearSessionCaches } from '@/lib/cache/sessionCache'
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout'
import { RETURN_PATH_KEY } from '@shared/lib/session/return-path'

vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }))
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
  getAccessToken: vi.fn(() => null),
}))
vi.mock('@/lib/hooks/useIdleTimeout', () => ({ useIdleTimeout: vi.fn() }))
vi.mock('@/lib/cache/sessionCache', () => ({ clearSessionCaches: vi.fn(), registerSessionCache: vi.fn(() => () => {}) }))

const { AuthProvider, ProfileUnavailableError, SUPPRESS_RETURN_SAVE_KEY } = await import('./AuthContext')
const { useAuth } = await import('@/lib/hooks/useAuth')

const mockedClearCaches = vi.mocked(clearSessionCaches)
const mockedGet = vi.mocked(api.get)
const mockedSignIn = vi.mocked(supabase.auth.signInWithPassword)
const mockedUseIdleTimeout = vi.mocked(useIdleTimeout)

/** The onExpire handler AuthProvider most recently armed the (mocked) idle timer with. */
function latestIdleExpiryHandler(): (() => void) | undefined {
  return mockedUseIdleTimeout.mock.calls.at(-1)?.[1]
}

const PROFILE: DispatcherUser = {
  id: '2c5b8c1e-6f2a-4f4a-9a1b-1f0d0a7c3e11' as DispatcherUser['id'],
  organization_id: '00000000-0000-0000-0000-000000000003',
  organization_name: 'Linbro Express',
  email: 'dispatcher@linbroexpress.co.za',
  full_name: 'Dispatcher',
  is_active: true,
  role: 'dispatcher',
}

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider })
}

type FakeSession = { access_token: string; user: { id: string } }
type AuthListener = (event: string, session: FakeSession | null) => void

const sessionOf = (access_token: string): FakeSession => ({ access_token, user: { id: 'user-1' } })

/** Register the provider's listener and hand it back, so a test can raise events itself. */
function captureAuthListener(): { current: AuthListener | undefined } {
  const held: { current: AuthListener | undefined } = { current: undefined }
  vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(((listener: AuthListener) => {
    held.current = listener
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  }) as unknown as typeof supabase.auth.onAuthStateChange)
  return held
}

/** Let a setTimeout(…, 0) deferral run, so "it never fetched" means never rather than not-yet. */
const flushDeferrals = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(((): unknown => (
    { data: { subscription: { unsubscribe: vi.fn() } } }
  )) as unknown as typeof supabase.auth.onAuthStateChange)
  mockedSignIn.mockResolvedValue({ data: { user: null, session: null }, error: null } as never)
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never)
  localStorage.clear()
  sessionStorage.clear()
})

describe('AuthContext.signIn', () => {
  it('leaves no window where the guard would read the state as signed out', async () => {
    mockedGet.mockResolvedValue(PROFILE)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.signIn({ email: PROFILE.email, password: 'pw' })
    })

    expect(result.current.isLoading && !result.current.user).toBe(false)
    expect(result.current.user).toEqual(PROFILE)
  })

  it('does not resolve while the profile is still in flight', async () => {
    let landProfile: (profile: DispatcherUser) => void = () => {}
    mockedGet.mockReturnValue(new Promise<DispatcherUser>(resolve => { landProfile = resolve }))

    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let settled = false
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = result.current.signIn({ email: PROFILE.email, password: 'pw' }).then(() => { settled = true })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(settled).toBe(false)
    expect(result.current.user).toBeNull()

    await act(async () => {
      landProfile(PROFILE)
      await pending
    })

    expect(settled).toBe(true)
    expect(result.current.user).toEqual(PROFILE)
  })

  it('reports a failed profile load as its own error, not as bad credentials', async () => {
    mockedGet.mockRejectedValue(new Error('backend unreachable'))
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'pw' }) }),
    ).rejects.toBeInstanceOf(ProfileUnavailableError)

    expect(result.current.isLoading).toBe(false)
  })

  it('surfaces a credential rejection and never asks for the profile', async () => {
    mockedSignIn.mockResolvedValue({
      data: { user: null, session: null }, error: new Error('Invalid login credentials'),
    } as never)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'wrong' }) }),
    ).rejects.toThrow('Invalid login credentials')

    expect(mockedGet).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })
})

describe('profile fetching', () => {
  it('does not fetch the profile twice for its own sign-in', async () => {
    const listener = captureAuthListener()
    mockedGet.mockResolvedValue(PROFILE)
    mockedSignIn.mockImplementation((async () => {
      listener.current?.('SIGNED_IN', sessionOf('tok'))
      return { data: { user: null, session: null }, error: null }
    }) as unknown as typeof supabase.auth.signInWithPassword)

    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    mockedGet.mockClear()

    await act(async () => {
      await result.current.signIn({ email: PROFILE.email, password: 'pw' })
    })
    await flushDeferrals()

    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(result.current.user).toEqual(PROFILE)
  })

  it('still loads the profile for a SIGNED_IN it did not raise', async () => {
    const listener = captureAuthListener()
    mockedGet.mockResolvedValue(PROFILE)

    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    mockedGet.mockClear()

    act(() => { listener.current?.('SIGNED_IN', sessionOf('tok')) })
    await flushDeferrals()

    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(result.current.user).toEqual(PROFILE)
  })
})

describe('AuthContext cache scoping', () => {
  it('forgets the previous dispatcher\'s records on sign-out', async () => {
    mockedGet.mockResolvedValue(PROFILE)
    const listener = captureAuthListener()
    const { result } = renderAuth()

    await act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'pw' }) })
    expect(mockedClearCaches).toHaveBeenCalledTimes(1)

    act(() => { listener.current?.('SIGNED_OUT', null) })

    expect(mockedClearCaches).toHaveBeenCalledTimes(2)
  })

  it('forgets them when one identity replaces another without passing through null', async () => {
    const other: DispatcherUser = { ...PROFILE, id: 'f0a1b2c3-0000-4000-8000-000000000009' as DispatcherUser['id'], email: 'other@linbroexpress.co.za' }
    mockedGet.mockResolvedValue(PROFILE)
    const listener = captureAuthListener()
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => { listener.current?.('SIGNED_IN', sessionOf('tok')) })
    await flushDeferrals()
    expect(mockedClearCaches).toHaveBeenCalledTimes(1)

    mockedGet.mockResolvedValue(other)
    act(() => { listener.current?.('SIGNED_IN', sessionOf('tok2')) })
    await flushDeferrals()

    expect(result.current.user).toEqual(other)
    expect(mockedClearCaches).toHaveBeenCalledTimes(2)
  })

  it('leaves the caches alone while the same dispatcher stays signed in', async () => {
    mockedGet.mockResolvedValue(PROFILE)
    const listener = captureAuthListener()
    const { result } = renderAuth()
    await act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'pw' }) })

    mockedClearCaches.mockClear()
    act(() => { listener.current?.('TOKEN_REFRESHED', sessionOf('tok2')) })
    await flushDeferrals()

    expect(mockedClearCaches).not.toHaveBeenCalled()
  })
})

describe('return path around idle expiry vs manual sign-out', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/trips/detail/9f1c8b2a')
  })

  it('idle expiry saves the current path, then signs out', async () => {
    mockedGet.mockResolvedValue(PROFILE)
    const { result } = renderAuth()
    await act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'pw' }) })

    const onExpire = latestIdleExpiryHandler()
    expect(onExpire).toBeInstanceOf(Function)

    act(() => { onExpire?.() })
    await flushDeferrals()

    expect(localStorage.getItem(RETURN_PATH_KEY)).toBe('/trips/detail/9f1c8b2a')
    expect(result.current.user).toBeNull()
  })

  it('manual sign-out clears a previously saved return path instead of setting one', async () => {
    mockedGet.mockResolvedValue(PROFILE)
    const { result } = renderAuth()
    await act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'pw' }) })
    localStorage.setItem(RETURN_PATH_KEY, '/trips/detail/9f1c8b2a')

    await act(async () => { await result.current.signOut() })

    expect(localStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })

  it('manual sign-out marks the suppress key so the guarded layout will not re-save it', async () => {
    mockedGet.mockResolvedValue(PROFILE)
    const { result } = renderAuth()
    await act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'pw' }) })

    await act(async () => { await result.current.signOut() })

    expect(sessionStorage.getItem(SUPPRESS_RETURN_SAVE_KEY)).toBe('1')
  })
})
