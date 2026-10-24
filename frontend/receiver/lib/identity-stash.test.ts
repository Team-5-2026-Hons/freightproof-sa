// frontend/receiver/lib/identity-stash.test.ts
//
// The stash holds a stranger's name and ID number between our page and the vendor's, and
// the outcome marker lets a reload tell "already confirmed" from "dead link". Both live in
// sessionStorage, which can hold anything — including another delivery's data — so what is
// read back is the behaviour under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIRM_OUTCOME_KEY,
  IDENTITY_STASH_KEY,
  clearStashedIdentity,
  readConfirmOutcome,
  readStashedIdentity,
  rememberConfirmOutcome,
  stashIdentity,
} from './identity-stash'

const TOKEN = 'tok-abc'
const OTHER_TOKEN = 'tok-xyz'
const IDENTITY = { name: 'Thandi Nkosi', idNumber: '9202204720082', token: TOKEN }

describe('identity stash', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips the typed identity and the token it belongs to', () => {
    stashIdentity(IDENTITY)

    expect(readStashedIdentity()).toEqual(IDENTITY)
  })

  it('reads nothing once cleared', () => {
    stashIdentity(IDENTITY)

    clearStashedIdentity()

    expect(readStashedIdentity()).toBeNull()
    expect(sessionStorage.getItem(IDENTITY_STASH_KEY)).toBeNull()
  })

  it('reads null when nothing was stashed', () => {
    expect(readStashedIdentity()).toBeNull()
  })

  it('reads null for text that is not JSON, and does not log what was in it', () => {
    sessionStorage.setItem(IDENTITY_STASH_KEY, 'Thandi Nkosi 9202204720082 {not json')

    expect(readStashedIdentity()).toBeNull()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('Thandi')
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('9202204720082')
  })

  it.each([
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['a record with no token', JSON.stringify({ name: 'A', idNumber: 'B' })],
    ['a record with a non-string name', JSON.stringify({ name: 1, idNumber: 'B', token: TOKEN })],
    ['a record with a non-string id', JSON.stringify({ name: 'A', idNumber: null, token: TOKEN })],
  ])('reads null for %s', (_label, raw) => {
    sessionStorage.setItem(IDENTITY_STASH_KEY, raw)

    expect(readStashedIdentity()).toBeNull()
  })

  it('does not throw when storage refuses writes, and says so', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    expect(() => stashIdentity(IDENTITY)).not.toThrow()
    expect(console.warn).toHaveBeenCalled()
  })

  it('does not throw when storage refuses reads', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })

    expect(readStashedIdentity()).toBeNull()
    expect(readConfirmOutcome(TOKEN)).toBeNull()
  })
})

describe('confirm outcome marker', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['attempted', 'confirmed'] as const)('round-trips %s for the same token', (state) => {
    rememberConfirmOutcome(TOKEN, state)

    expect(readConfirmOutcome(TOKEN)).toBe(state)
  })

  it('reads null for a different token', () => {
    rememberConfirmOutcome(TOKEN, 'confirmed')

    expect(readConfirmOutcome(OTHER_TOKEN)).toBeNull()
  })

  it('reads null when nothing was recorded', () => {
    expect(readConfirmOutcome(TOKEN)).toBeNull()
  })

  it('moves from attempted to confirmed for the same token', () => {
    rememberConfirmOutcome(TOKEN, 'attempted')
    rememberConfirmOutcome(TOKEN, 'confirmed')

    expect(readConfirmOutcome(TOKEN)).toBe('confirmed')
  })

  it('holds the token and state and nothing else — no personal data', () => {
    rememberConfirmOutcome(TOKEN, 'attempted')

    expect(JSON.parse(sessionStorage.getItem(CONFIRM_OUTCOME_KEY) ?? 'null')).toEqual({
      token: TOKEN,
      state: 'attempted',
    })
  })

  it.each([
    ['text that is not JSON', 'confirmed'],
    ['an unknown state', JSON.stringify({ token: TOKEN, state: 'maybe' })],
    ['no state', JSON.stringify({ token: TOKEN })],
    ['a bare string', JSON.stringify('confirmed')],
  ])('reads null for %s', (_label, raw) => {
    sessionStorage.setItem(CONFIRM_OUTCOME_KEY, raw)

    expect(readConfirmOutcome(TOKEN)).toBeNull()
  })
})
