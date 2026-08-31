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
// The idle timer is wiring around real timers and a BroadcastChannel; none of it is what
// these tests are about, and leaving it live only adds a source of open handles.
vi.mock('@/lib/hooks/useIdleTimeout', () => ({ useIdleTimeout: vi.fn() }))

const { AuthProvider, ProfileUnavailableError } = await import('./AuthContext')
const { useAuth } = await import('@/lib/hooks/useAuth')

const mockedGet = vi.mocked(api.get)
const mockedSignIn = vi.mocked(supabase.auth.signInWithPassword)

const PROFILE: DispatcherUser = {
  id: '2c5b8c1e-6f2a-4f4a-9a1b-1f0d0a7c3e11' as DispatcherUser['id'],
  organization_id: '00000000-0000-0000-0000-000000000003',
  email: 'dispatcher@linbroexpress.co.za',
  full_name: 'Dispatcher',
  is_active: true,
  role: 'dispatcher',
}

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider })
}

// Supabase's onAuthStateChange callback, as this file needs to drive it.
type AuthListener = (event: string, session: { access_token: string } | null) => void

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
  // Restored per test: captureAuthListener() replaces the implementation, and it would
  // otherwise leak into whichever test ran next.
  vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(((): unknown => (
    { data: { subscription: { unsubscribe: vi.fn() } } }
  )) as unknown as typeof supabase.auth.onAuthStateChange)
  mockedSignIn.mockResolvedValue({ data: { user: null, session: null }, error: null } as never)
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never)
})

describe('AuthContext.signIn', () => {
  // The bug this file was written for: signIn used to resolve as soon as the credentials
  // were accepted, so the login page navigated while `user` was still null and the guard
  // sent the dispatcher straight back — every sign-in took two attempts.
  it('leaves no window where the guard would read the state as signed out', async () => {
    mockedGet.mockResolvedValue(PROFILE)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.signIn({ email: PROFILE.email, password: 'pw' })
    })

    // The exact predicate app/(app)/layout.tsx redirects on.
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
      // Let every already-queued microtask drain, so "not settled" means genuinely
      // waiting on the profile rather than merely not having been scheduled yet.
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
    // fetchProfile swallows the transport error and returns null — the caller only ever
    // sees "no profile", which must not be reported to the user as a wrong password.
    mockedGet.mockRejectedValue(new Error('backend unreachable'))
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'pw' }) }),
    ).rejects.toBeInstanceOf(ProfileUnavailableError)

    // Stranding the form mid-spinner would be its own bug.
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
  // signIn awaits the profile itself, and Supabase raises SIGNED_IN during the credential
  // exchange — so without a claim between them, one login fetched /auth/me twice.
  it('does not fetch the profile twice for its own sign-in', async () => {
    const listener = captureAuthListener()
    mockedGet.mockResolvedValue(PROFILE)
    mockedSignIn.mockImplementation((async () => {
      // Where Supabase actually raises it: inside signInWithPassword, before signIn returns.
      listener.current?.('SIGNED_IN', { access_token: 'tok' })
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

  // The other half: the claim must be consumed, not left standing, or the next sign-in
  // that did NOT come through signIn would silently never load a profile.
  it('still loads the profile for a SIGNED_IN it did not raise', async () => {
    const listener = captureAuthListener()
    mockedGet.mockResolvedValue(PROFILE)

    const { result } = renderAuth()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    mockedGet.mockClear()

    act(() => { listener.current?.('SIGNED_IN', { access_token: 'tok' }) })
    await flushDeferrals()

    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(result.current.user).toEqual(PROFILE)
  })
})
