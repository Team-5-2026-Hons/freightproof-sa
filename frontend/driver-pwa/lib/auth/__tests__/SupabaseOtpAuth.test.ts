/**
 * SupabaseOtpAuth: the only place the driver app talks to Supabase phone auth. Holds down
 * the exact arguments Supabase receives, the event translation the provider relies on, and
 * that the vendor's own error object reaches the OTP screens.
 */

import { describe, expect, it, vi } from 'vitest'

import type { AuthChangeListener } from '@shared/lib/auth/port'
import { SupabaseOtpAuth } from '../SupabaseOtpAuth'

type AuthStateCallback = (event: string, session: unknown) => void

function fakeClient() {
  const unsubscribe = vi.fn()
  let callback: AuthStateCallback | undefined
  const auth = {
    getSession: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
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
    client: { auth } as unknown as ConstructorParameters<typeof SupabaseOtpAuth>[0],
  }
}

const SESSION = { access_token: 'tok', user: { id: 'driver-1' } }

describe('SupabaseOtpAuth.getSession', () => {
  it('reduces a session to the signed-in user id', async () => {
    const fake = fakeClient()
    fake.auth.getSession.mockResolvedValue({ data: { session: SESSION } })

    expect(await new SupabaseOtpAuth(fake.client).getSession()).toEqual({ userId: 'driver-1' })
  })

  it('returns null when nobody is signed in', async () => {
    const fake = fakeClient()
    fake.auth.getSession.mockResolvedValue({ data: { session: null } })

    expect(await new SupabaseOtpAuth(fake.client).getSession()).toBeNull()
  })
})

describe('SupabaseOtpAuth.onChange', () => {
  it.each([
    ['SIGNED_IN', 'signed_in'],
    ['SIGNED_OUT', 'signed_out'],
    ['TOKEN_REFRESHED', 'session_updated'],
    ['INITIAL_SESSION', 'session_updated'],
  ])('maps the vendor event %s to %s', (vendorEvent, expected) => {
    const fake = fakeClient()
    const listener = vi.fn<AuthChangeListener>()
    new SupabaseOtpAuth(fake.client).onChange(listener)

    fake.raise(vendorEvent, SESSION)

    expect(listener).toHaveBeenCalledWith(expected, { userId: 'driver-1' })
  })

  it('passes a missing session through as null', () => {
    const fake = fakeClient()
    const listener = vi.fn<AuthChangeListener>()
    new SupabaseOtpAuth(fake.client).onChange(listener)

    fake.raise('SIGNED_OUT', null)

    expect(listener).toHaveBeenCalledWith('signed_out', null)
  })

  it('returns a function that removes the vendor subscription', () => {
    const fake = fakeClient()

    new SupabaseOtpAuth(fake.client).onChange(vi.fn())()

    expect(fake.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('SupabaseOtpAuth.requestOtp', () => {
  // shouldCreateUser: false is a security property (only provisioned drivers can sign in).
  it('asks for a WhatsApp code and never creates a user', async () => {
    const fake = fakeClient()
    fake.auth.signInWithOtp.mockResolvedValue({ error: null })

    await new SupabaseOtpAuth(fake.client).requestOtp('+27821234567')

    expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({
      phone: '+27821234567',
      options: { channel: 'whatsapp', shouldCreateUser: false },
    })
  })

  it('rejects with the vendor error itself', async () => {
    const fake = fakeClient()
    const vendorError = new Error('Signups not allowed for otp')
    fake.auth.signInWithOtp.mockResolvedValue({ error: vendorError })

    await expect(new SupabaseOtpAuth(fake.client).requestOtp('+27800000000')).rejects.toBe(vendorError)
  })
})

describe('SupabaseOtpAuth.verifyOtp', () => {
  it('exchanges the code for a session', async () => {
    const fake = fakeClient()
    fake.auth.verifyOtp.mockResolvedValue({ error: null })

    await new SupabaseOtpAuth(fake.client).verifyOtp('+27821234567', '123456')

    expect(fake.auth.verifyOtp).toHaveBeenCalledWith({ phone: '+27821234567', token: '123456', type: 'sms' })
  })

  it('rejects with the vendor error itself', async () => {
    const fake = fakeClient()
    const vendorError = new Error('Token has expired or is invalid')
    fake.auth.verifyOtp.mockResolvedValue({ error: vendorError })

    await expect(new SupabaseOtpAuth(fake.client).verifyOtp('+27821234567', '000000')).rejects.toBe(vendorError)
  })
})

describe('SupabaseOtpAuth.signOut', () => {
  it('signs out of the vendor session', async () => {
    const fake = fakeClient()

    await new SupabaseOtpAuth(fake.client).signOut()

    expect(fake.auth.signOut).toHaveBeenCalledTimes(1)
  })
})
