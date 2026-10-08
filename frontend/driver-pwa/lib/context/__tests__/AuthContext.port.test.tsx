/**
 * AuthProvider against fake ports.
 *
 * AuthContext.test.tsx (demo) and AuthContext.real.test.tsx drive the provider through the
 * real adapters over a mocked SDK. This file proves the point of the ports: the provider's
 * session logic runs against any backend that satisfies the interfaces, and never reaches
 * for the vendor client or the API behind them.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthChangeListener, AuthSession, OtpAuthPort } from '@shared/lib/auth/port'
import type { DriverProfileSource } from '@/lib/auth/DriverProfileSource'
import { AuthProvider } from '@/lib/context/AuthContext'
import { useAuth } from '@/lib/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api/client'
import type { DriverUser } from '@/lib/types/user'

// Stubs that record any call: the assertions below require them to stay untouched.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() },
  },
}))
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() }, ApiError: class ApiError extends Error {} }))
vi.mock('@/lib/hooks/useIdleTimeout', () => ({ useIdleTimeout: vi.fn() }))

const DRIVER = { id: 'driver-1', full_name: 'Fake Driver' } as unknown as DriverUser
const OTHER_DRIVER = { id: 'driver-2', full_name: 'Other Driver' } as unknown as DriverUser

/** A backend that lives entirely in memory and can raise session events on demand. */
class FakeOtpAuth implements OtpAuthPort {
  session: AuthSession | null = null
  listener: AuthChangeListener | null = null
  readonly unsubscribe = vi.fn()
  readonly requestedFor: string[] = []
  readonly verified: Array<[string, string]> = []
  readonly signOutCalls = vi.fn()
  rejectRequestWith: Error | null = null
  rejectVerifyWith: Error | null = null

  async getSession(): Promise<AuthSession | null> { return this.session }

  onChange(listener: AuthChangeListener): () => void {
    this.listener = listener
    return this.unsubscribe
  }

  async requestOtp(phoneNumber: string): Promise<void> {
    if (this.rejectRequestWith) throw this.rejectRequestWith
    this.requestedFor.push(phoneNumber)
  }

  async verifyOtp(phoneNumber: string, otp: string): Promise<void> {
    if (this.rejectVerifyWith) throw this.rejectVerifyWith
    this.verified.push([phoneNumber, otp])
    this.session = { userId: String(DRIVER.id) }
  }

  async signOut(): Promise<void> {
    this.signOutCalls()
    this.session = null
  }
}

function fakeProfiles(profile: DriverUser | null = DRIVER) {
  const loadProfile = vi.fn<() => Promise<DriverUser | null>>().mockResolvedValue(profile)
  return { loadProfile } satisfies DriverProfileSource
}

function renderWith(port: OtpAuthPort, profiles: DriverProfileSource) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider port={port} profiles={profiles}>{children}</AuthProvider>
  )
  return renderHook(() => useAuth(), { wrapper })
}

function expectNothingElseTouched() {
  const auth = vi.mocked(supabase.auth)
  for (const method of Object.values(auth)) expect(method).not.toHaveBeenCalled()
  expect(vi.mocked(api.get)).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('AuthProvider with injected ports', () => {
  it('restores an existing session through the profile source', async () => {
    const port = new FakeOtpAuth()
    port.session = { userId: String(DRIVER.id) }
    const profiles = fakeProfiles()

    const { result } = renderWith(port, profiles)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBe(DRIVER)
    expectNothingElseTouched()
  })

  it('stays signed out, and loads no profile, when the port reports no session', async () => {
    const profiles = fakeProfiles()

    const { result } = renderWith(new FakeOtpAuth(), profiles)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(profiles.loadProfile).not.toHaveBeenCalled()
  })

  it('requests a code through the port and clears loading afterwards', async () => {
    const port = new FakeOtpAuth()
    const { result } = renderWith(port, fakeProfiles())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.requestOtp('+27821234567') })

    expect(port.requestedFor).toEqual(['+27821234567'])
    expect(result.current.isLoading).toBe(false)
    expectNothingElseTouched()
  })

  it("surfaces the port's rejection from requestOtp and still clears loading", async () => {
    const port = new FakeOtpAuth()
    port.rejectRequestWith = new Error('Signups not allowed for otp')
    const { result } = renderWith(port, fakeProfiles())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => { await result.current.requestOtp('+27800000000') }),
    ).rejects.toThrow('Signups not allowed for otp')

    expect(result.current.isLoading).toBe(false)
  })

  it('verifies the code through the port, then loads the profile', async () => {
    const port = new FakeOtpAuth()
    const profiles = fakeProfiles()
    const { result } = renderWith(port, profiles)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.signIn({ phone_number: '+27821234567', otp: '123456' }) })

    expect(port.verified).toEqual([['+27821234567', '123456']])
    expect(profiles.loadProfile).toHaveBeenCalledTimes(1)
    expect(result.current.user).toBe(DRIVER)
    expectNothingElseTouched()
  })

  it("surfaces the port's rejection from signIn, sets no user and loads no profile", async () => {
    const port = new FakeOtpAuth()
    port.rejectVerifyWith = new Error('Token has expired or is invalid')
    const profiles = fakeProfiles()
    const { result } = renderWith(port, profiles)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => { await result.current.signIn({ phone_number: '+27821234567', otp: '000000' }) }),
    ).rejects.toThrow('Token has expired or is invalid')

    expect(result.current.user).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(profiles.loadProfile).not.toHaveBeenCalled()
  })

  it('clears the user when the port reports no session', async () => {
    const port = new FakeOtpAuth()
    port.session = { userId: String(DRIVER.id) }
    const { result } = renderWith(port, fakeProfiles())
    await waitFor(() => expect(result.current.user).toBe(DRIVER))

    act(() => { port.listener?.('signed_out', null) })

    expect(result.current.user).toBeNull()
  })

  // The guard that stops a re-fired SIGNED_IN from creating a new `user` object and
  // sending every consumer into a refetch loop.
  it('does not reload the profile for a change that keeps the same identity', async () => {
    const port = new FakeOtpAuth()
    port.session = { userId: String(DRIVER.id) }
    const profiles = fakeProfiles()
    const { result } = renderWith(port, profiles)
    await waitFor(() => expect(result.current.user).toBe(DRIVER))
    profiles.loadProfile.mockClear()

    await act(async () => { port.listener?.('signed_in', { userId: String(DRIVER.id) }) })

    expect(profiles.loadProfile).not.toHaveBeenCalled()
  })

  it('reloads the profile when a different identity signs in', async () => {
    const port = new FakeOtpAuth()
    port.session = { userId: String(DRIVER.id) }
    const profiles = fakeProfiles()
    const { result } = renderWith(port, profiles)
    await waitFor(() => expect(result.current.user).toBe(DRIVER))
    profiles.loadProfile.mockResolvedValue(OTHER_DRIVER)

    await act(async () => { port.listener?.('signed_in', { userId: String(OTHER_DRIVER.id) }) })

    expect(result.current.user).toBe(OTHER_DRIVER)
  })

  it('signs out through the port', async () => {
    const port = new FakeOtpAuth()
    port.session = { userId: String(DRIVER.id) }
    const { result } = renderWith(port, fakeProfiles())
    await waitFor(() => expect(result.current.user).toBe(DRIVER))

    await act(async () => { await result.current.signOut() })

    expect(port.signOutCalls).toHaveBeenCalledTimes(1)
    expect(result.current.user).toBeNull()
    expectNothingElseTouched()
  })

  it('removes its subscription when unmounted', async () => {
    const port = new FakeOtpAuth()
    const { result, unmount } = renderWith(port, fakeProfiles())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    unmount()

    expect(port.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
