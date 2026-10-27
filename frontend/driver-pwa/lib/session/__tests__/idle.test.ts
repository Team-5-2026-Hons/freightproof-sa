/**
 * Tests for the shared inactivity-timeout logic (@shared/lib/session/idle).
 *
 * The module under test is shared and imported by BOTH apps; this file lives in the
 * driver-pwa tree for two reasons. First, vitest's `include` globs from each app's own
 * root, so a test placed inside frontend/shared is never collected by either. Second,
 * the dispatcher's own vitest cannot currently start at all — it pins vitest 3.2.6
 * against vite 7.3.6, which fails to load its config with ERR_REQUIRE_ESM. That break
 * predates this change (every existing dispatcher test fails the same way) and is
 * flagged separately; putting the test here means the logic is actually verified rather
 * than merely written.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CLIENT_IDLE_TIMEOUT_MS,
  LAST_ACTIVITY_KEY,
  SESSION_IDLE_TIMEOUT_MS,
  clearActivity,
  isSessionExpired,
  msUntilExpiry,
  readLastActivity,
  recordActivity,
  type ActivityStore,
} from '@shared/lib/session/idle'

/** In-memory stand-in for localStorage. */
function makeStore(initial: Record<string, string> = {}): ActivityStore {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const brokenStore: ActivityStore = {
  getItem: () => { throw new Error('storage unavailable') },
  setItem: () => { throw new Error('storage unavailable') },
  removeItem: () => { throw new Error('storage unavailable') },
}

describe('the timeout window', () => {
  it('is an hour, matching the backend', () => {
    expect(SESSION_IDLE_TIMEOUT_MS).toBe(60 * 60 * 1000)
  })

  it('fires slightly before the server so the user gets a clean sign-out rather than a failed request', () => {
    expect(CLIENT_IDLE_TIMEOUT_MS).toBeLessThan(SESSION_IDLE_TIMEOUT_MS)
  })
})

describe('recording and reading activity', () => {
  let store: ActivityStore

  beforeEach(() => {
    store = makeStore()
  })

  it('round-trips a timestamp', () => {
    recordActivity(store, 1_700_000_000_000)

    expect(readLastActivity(store)).toBe(1_700_000_000_000)
  })

  it('reports no history before anything is recorded', () => {
    expect(readLastActivity(store)).toBeNull()
  })

  it('forgets the timestamp on sign-out', () => {
    recordActivity(store, 1_700_000_000_000)

    clearActivity(store)

    expect(readLastActivity(store)).toBeNull()
  })

  it('treats a corrupted value as no history rather than NaN', () => {
    const corrupted = makeStore({ [LAST_ACTIVITY_KEY]: 'not-a-number' })

    expect(readLastActivity(corrupted)).toBeNull()
  })

  it('survives a storage backend that throws', () => {
    expect(() => recordActivity(brokenStore)).not.toThrow()
    expect(() => clearActivity(brokenStore)).not.toThrow()
    expect(readLastActivity(brokenStore)).toBeNull()
  })
})

describe('deciding whether the session has expired', () => {
  const now = 1_700_000_000_000

  it('is not expired immediately after activity', () => {
    expect(isSessionExpired(now, now)).toBe(false)
  })

  it('is not expired one millisecond before the window closes', () => {
    expect(isSessionExpired(now - CLIENT_IDLE_TIMEOUT_MS + 1, now)).toBe(false)
  })

  it('is expired exactly on the window', () => {
    expect(isSessionExpired(now - CLIENT_IDLE_TIMEOUT_MS, now)).toBe(true)
  })

  it('is expired well past the window', () => {
    expect(isSessionExpired(now - CLIENT_IDLE_TIMEOUT_MS * 3, now)).toBe(true)
  })

  it('does not expire a session with no stored history', () => {
    expect(isSessionExpired(null, now)).toBe(false)
  })

  it('tolerates a timestamp in the future rather than clamping it', () => {
    expect(isSessionExpired(now + 60_000, now)).toBe(false)
  })
})

describe('scheduling the next check', () => {
  const now = 1_700_000_000_000

  it('waits the full window when activity just happened', () => {
    expect(msUntilExpiry(now, now)).toBe(CLIENT_IDLE_TIMEOUT_MS)
  })

  it('waits only the remainder partway through the window', () => {
    expect(msUntilExpiry(now - 60_000, now)).toBe(CLIENT_IDLE_TIMEOUT_MS - 60_000)
  })

  it('never returns zero or a negative delay, which would spin the timer', () => {
    expect(msUntilExpiry(now - CLIENT_IDLE_TIMEOUT_MS * 5, now)).toBeGreaterThan(0)
  })

  it('assumes a full window when there is no history', () => {
    expect(msUntilExpiry(null, now)).toBe(CLIENT_IDLE_TIMEOUT_MS)
  })
})

describe('the reload case', () => {
  it('an expired session is not revived by refreshing the page', () => {
    const now = 1_700_000_000_000
    const store = makeStore()
    recordActivity(store, now - CLIENT_IDLE_TIMEOUT_MS - 1)

    expect(isSessionExpired(readLastActivity(store), now)).toBe(true)
  })
})
