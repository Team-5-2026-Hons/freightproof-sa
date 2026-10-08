/**
 * AuthProvider against a fake PasswordAuthPort.
 *
 * AuthContext.test.tsx drives the provider through a mocked Supabase SDK. This file proves
 * the point of the port: the provider's session logic runs against any backend that
 * satisfies the interface, and never reaches for the vendor client behind it.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import { supabase } from '@/lib/supabase/client'
import type { DispatcherUser } from '@/lib/types/user'
import type {
  AuthChangeListener,
  AuthSession,
  PasswordAuthPort,
  PasswordCredentials,
} from '@shared/lib/auth/port'

vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }))
// A stub that records any call: the assertions below require it to stay untouched.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  },
  getAccessToken: vi.fn(() => null),
}))
vi.mock('@/lib/hooks/useIdleTimeout', () => ({ useIdleTimeout: vi.fn() }))
vi.mock('@/lib/cache/sessionCache', () => ({ clearSessionCaches: vi.fn(), registerSessionCache: vi.fn(() => () => {}) }))

const { AuthProvider } = await import('./AuthContext')
const { useAuth } = await import('@/lib/hooks/useAuth')

const mockedGet = vi.mocked(api.get)

const PROFILE: DispatcherUser = {
  id: 'dispatcher-1' as DispatcherUser['id'],
  organization_id: '00000000-0000-0000-0000-000000000003',
  organization_name: 'Linbro Express',
  email: 'dispatcher@linbroexpress.co.za',
  full_name: 'Dispatcher',
  is_active: true,
  role: 'dispatcher',
}

/** A backend that lives entirely in memory and can raise session events on demand. */
class FakePasswordAuth implements PasswordAuthPort {
  session: AuthSession | null = null
  listener: AuthChangeListener | null = null
  readonly unsubscribe = vi.fn()
  readonly signOutCalls = vi.fn()
  rejectSignInWith: Error | null = null

  async getSession(): Promise<AuthSession | null> {
    return this.session
  }

  onChange(listener: AuthChangeListener): () => void {
    this.listener = listener
    return this.unsubscribe
  }

  async signInWithPassword(_credentials: PasswordCredentials): Promise<void> {
    if (this.rejectSignInWith) throw this.rejectSignInWith
    this.session = { userId: PROFILE.id }
  }

  async signOut(): Promise<void> {
    this.signOutCalls()
    this.session = null
  }
}

function renderWith(port: PasswordAuthPort) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider port={port}>{children}</AuthProvider>
  )
  return renderHook(() => useAuth(), { wrapper })
}

function expectVendorClientUntouched() {
  const auth = vi.mocked(supabase.auth)
  expect(auth.signInWithPassword).not.toHaveBeenCalled()
  expect(auth.signOut).not.toHaveBeenCalled()
  expect(auth.getSession).not.toHaveBeenCalled()
  expect(auth.onAuthStateChange).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  mockedGet.mockResolvedValue(PROFILE)
})

describe('AuthProvider with an injected port', () => {
  it('restores an existing session and loads the profile', async () => {
    const port = new FakePasswordAuth()
    port.session = { userId: PROFILE.id }

    const { result } = renderWith(port)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toEqual(PROFILE)
    expectVendorClientUntouched()
  })

  it('stays signed out when the port reports no session', async () => {
    const port = new FakePasswordAuth()

    const { result } = renderWith(port)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('signs in through the port and exposes the profile', async () => {
    const port = new FakePasswordAuth()
    const { result } = renderWith(port)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.signIn({ email: PROFILE.email, password: 'pw' })
    })

    expect(result.current.user).toEqual(PROFILE)
    expectVendorClientUntouched()
  })

  it("surfaces the port's own rejection and never asks for a profile", async () => {
    const port = new FakePasswordAuth()
    port.rejectSignInWith = new Error('Invalid login credentials')
    const { result } = renderWith(port)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => { await result.current.signIn({ email: PROFILE.email, password: 'bad' }) }),
    ).rejects.toThrow('Invalid login credentials')

    expect(mockedGet).not.toHaveBeenCalled()
    expect(result.current.user).toBeNull()
  })

  it('clears the user when the port raises signed_out', async () => {
    const port = new FakePasswordAuth()
    port.session = { userId: PROFILE.id }
    const { result } = renderWith(port)
    await waitFor(() => expect(result.current.user).toEqual(PROFILE))

    act(() => { port.listener?.('signed_out', null) })

    expect(result.current.user).toBeNull()
  })

  it('does not refetch the profile for a token refresh', async () => {
    const port = new FakePasswordAuth()
    port.session = { userId: PROFILE.id }
    const { result } = renderWith(port)
    await waitFor(() => expect(result.current.user).toEqual(PROFILE))
    mockedGet.mockClear()

    act(() => { port.listener?.('session_updated', { userId: PROFILE.id }) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('signs out through the port', async () => {
    const port = new FakePasswordAuth()
    port.session = { userId: PROFILE.id }
    const { result } = renderWith(port)
    await waitFor(() => expect(result.current.user).toEqual(PROFILE))

    await act(async () => { await result.current.signOut() })

    expect(port.signOutCalls).toHaveBeenCalledTimes(1)
    expect(result.current.user).toBeNull()
    expectVendorClientUntouched()
  })

  it('removes its subscription when unmounted', async () => {
    const port = new FakePasswordAuth()
    const { result, unmount } = renderWith(port)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    unmount()

    expect(port.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
