// frontend/driver-pwa/components/phase/__tests__/sealsMatch.test.ts
//
// Moved from components/handshake/steps/__tests__/H3ExitSeal.test.tsx's `describe('sealsMatch', ...)`
// block — the rest of that file tested H3ExitSeal itself, which is retired (its step no
// longer exists in any phase recipe; its confirmation UI merged into
// departure/CaptureSeal.tsx). This pure-logic suite survives unchanged: it covers the
// comparison branches (match / case-insensitive match / whitespace-tolerant / mismatch /
// null reference / empty input) shared by every caller of sealsMatch, so the
// live-indicator-vs-persisted-value drift bug (commit c1a8c2b) can't recur silently in
// either departure/CaptureSeal.tsx or unloading/SealVerify.tsx.
import { describe, it, expect } from 'vitest'
import { sealsMatch } from '../sealsMatch'

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

  it('returns false when the reference is null (indeterminate reference)', () => {
    expect(sealsMatch('FP-1234', null)).toBe(false)
  })

  it('returns false when driver input is empty', () => {
    expect(sealsMatch('', 'FP-1234')).toBe(false)
  })

  it('returns false when both input and reference are empty/null', () => {
    expect(sealsMatch('', null)).toBe(false)
  })
})
