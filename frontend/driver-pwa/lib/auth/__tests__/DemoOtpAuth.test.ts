/** DemoOtpAuth: the demo walkthrough's stand-in for an auth server. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MOCK_DRIVER } from '../DemoDriverProfileSource'
import { DEMO_SESSION_KEY, DemoOtpAuth } from '../DemoOtpAuth'

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DemoOtpAuth', () => {
  it('has no session until a code has been verified', async () => {
    expect(await new DemoOtpAuth().getSession()).toBeNull()
  })

  it('verifying a code starts a session that survives a new instance (a page refresh)', async () => {
    const verify = new DemoOtpAuth().verifyOtp('+27821234567', '123456')
    await vi.runAllTimersAsync()
    await verify

    expect(sessionStorage.getItem(DEMO_SESSION_KEY)).toBe('true')
    expect(await new DemoOtpAuth().getSession()).toEqual({ userId: String(MOCK_DRIVER.id) })
  })

  it('accepts any code: the demo has no server to reject one', async () => {
    const verify = new DemoOtpAuth().verifyOtp('+27821234567', 'not-a-real-code')
    await vi.runAllTimersAsync()

    await expect(verify).resolves.toBeUndefined()
  })

  it('takes a beat to answer, like a real round trip', async () => {
    const settled = vi.fn()
    void new DemoOtpAuth().requestOtp('+27821234567').then(settled)

    await vi.advanceTimersByTimeAsync(100)
    expect(settled).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('signing out ends the session', async () => {
    sessionStorage.setItem(DEMO_SESSION_KEY, 'true')
    const auth = new DemoOtpAuth()

    await auth.signOut()

    expect(sessionStorage.getItem(DEMO_SESSION_KEY)).toBeNull()
    expect(await auth.getSession()).toBeNull()
  })

  it('never reports session changes, and its unsubscribe is safe to call', () => {
    const listener = vi.fn()

    const unsubscribe = new DemoOtpAuth().onChange(listener)
    unsubscribe()

    expect(listener).not.toHaveBeenCalled()
  })
})
