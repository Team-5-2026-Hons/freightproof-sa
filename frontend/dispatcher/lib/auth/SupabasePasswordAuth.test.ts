/**
 * SupabasePasswordAuth: the only place the dispatcher talks to Supabase Auth. These tests
 * hold down the translation the provider relies on: sessions reduced to an identity,
 * vendor events renamed, vendor errors passed through untouched.
 */

import { describe, expect, it, vi } from 'vitest'

import type { AuthChangeListener } from '@shared/lib/auth/port'

// The module under test also builds the default adapter from the real client at import.
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: {} } }))

const { SupabasePasswordAuth } = await import('./SupabasePasswordAuth')

type AuthStateCallback = (event: string, session: unknown) => void

function fakeClient() {
  const unsubscribe = vi.fn()
  let callback: AuthStateCallback | undefined
  const auth = {
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn((cb: AuthStateCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe } } }
    }),
  }
  return {
    auth,
    unsubscribe,
    raise: (event: string, session: unknown) => callback?.(event, session),
    // The adapter takes a structural subset of the Supabase client.
    client: { auth } as unknown as ConstructorParameters<typeof SupabasePasswordAuth>[0],
  }
}

const SESSION = { access_token: 'tok', user: { id: 'user-1' } }

describe('SupabasePasswordAuth.getSession', () => {
  it('reduces a session to the signed-in user id', async () => {
    const fake = fakeClient()
    fake.auth.getSession.mockResolvedValue({ data: { session: SESSION } })

    expect(await new SupabasePasswordAuth(fake.client).getSession()).toEqual({ userId: 'user-1' })
  })

  it('returns null when nobody is signed in', async () => {
    const fake = fakeClient()
    fake.auth.getSession.mockResolvedValue({ data: { session: null } })

    expect(await new SupabasePasswordAuth(fake.client).getSession()).toBeNull()
  })
})

describe('SupabasePasswordAuth.onChange', () => {
  it.each([
    ['SIGNED_IN', 'signed_in'],
    ['SIGNED_OUT', 'signed_out'],
    ['TOKEN_REFRESHED', 'session_updated'],
    ['USER_UPDATED', 'session_updated'],
    ['INITIAL_SESSION', 'session_updated'],
  ])('maps the vendor event %s to %s', (vendorEvent, expected) => {
    const fake = fakeClient()
    const listener = vi.fn<AuthChangeListener>()
    new SupabasePasswordAuth(fake.client).onChange(listener)

    fake.raise(vendorEvent, SESSION)

    expect(listener).toHaveBeenCalledWith(expected, { userId: 'user-1' })
  })

  it('passes a missing session through as null', () => {
    const fake = fakeClient()
    const listener = vi.fn<AuthChangeListener>()
    new SupabasePasswordAuth(fake.client).onChange(listener)

    fake.raise('SIGNED_OUT', null)

    expect(listener).toHaveBeenCalledWith('signed_out', null)
  })

  it('returns a function that removes the vendor subscription', () => {
    const fake = fakeClient()

    const unsubscribe = new SupabasePasswordAuth(fake.client).onChange(vi.fn())
    unsubscribe()

    expect(fake.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('SupabasePasswordAuth.signInWithPassword', () => {
  it('forwards the credentials and resolves on success', async () => {
    const fake = fakeClient()
    fake.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })

    await new SupabasePasswordAuth(fake.client).signInWithPassword({ email: 'a@b.co', password: 'pw' })

    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' })
  })

  // The login page displays this error's own message, so it must be the vendor's object.
  it('rejects with the vendor error itself', async () => {
    const fake = fakeClient()
    const vendorError = new Error('Invalid login credentials')
    fake.auth.signInWithPassword.mockResolvedValue({ data: {}, error: vendorError })

    await expect(
      new SupabasePasswordAuth(fake.client).signInWithPassword({ email: 'a@b.co', password: 'bad' }),
    ).rejects.toBe(vendorError)
  })
})

describe('SupabasePasswordAuth.signOut', () => {
  it('signs out of the vendor session', async () => {
    const fake = fakeClient()

    await new SupabasePasswordAuth(fake.client).signOut()

    expect(fake.auth.signOut).toHaveBeenCalledTimes(1)
  })
})
