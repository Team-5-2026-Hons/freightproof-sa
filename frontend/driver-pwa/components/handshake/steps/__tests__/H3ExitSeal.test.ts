// frontend/driver-pwa/components/handshake/steps/__tests__/H3ExitSeal.test.ts
import { describe, it, expect } from 'vitest'
import { sealsMatch } from '../H3ExitSeal'

// Locks in the comparison logic behind H3's "confirm seal" exception flag (commit c1a8c2b),
// covering the branch set flagged in code-quality review: match / case-insensitive match /
// mismatch / indeterminate (null h2SealNumber) / empty input. A prior bug in this exact area
// was a drift between the live indicator's comparison and the persisted sealVerifiedMatch value —
// this suite tests the single shared helper both call, so that class of bug can't recur silently.
describe('sealsMatch', () => {
  it('returns true for an exact match', () => {
    expect(sealsMatch('FP-1234', 'FP-1234')).toBe(true)
  })

  it('returns true for a case-insensitive match', () => {
    expect(sealsMatch('fp-1234', 'FP-1234')).toBe(true)
  })

  it('returns true when only whitespace differs', () => {
    expect(sealsMatch('  FP-1234  ', 'FP-1234')).toBe(true)
  })

  it('returns false for a mismatch', () => {
    expect(sealsMatch('FP-1234', 'FP-5678')).toBe(false)
  })

  it('returns false when h2SealNumber is null (indeterminate reference)', () => {
    expect(sealsMatch('FP-1234', null)).toBe(false)
  })

  it('returns false when driver input is empty', () => {
    expect(sealsMatch('', 'FP-1234')).toBe(false)
  })

  it('returns false when both input and reference are empty/null', () => {
    expect(sealsMatch('', null)).toBe(false)
  })
})
