import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SIGNED_OUT_REASON_KEY,
  consumeSignedOutReason,
  rememberSignedOutReason,
} from '../signed-out-reason'

afterEach(() => {
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('signed-out reason', () => {
  it('hands back the remembered message once, then nothing', () => {
    rememberSignedOutReason('Signed in on another device.')

    expect(consumeSignedOutReason()).toBe('Signed in on another device.')
    expect(consumeSignedOutReason()).toBeNull()
    expect(window.sessionStorage.getItem(SIGNED_OUT_REASON_KEY)).toBeNull()
  })

  it('returns null when no sign-out left a reason', () => {
    expect(consumeSignedOutReason()).toBeNull()
  })

  it('treats unreadable storage as no reason rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(consumeSignedOutReason()).toBeNull()
  })
})
