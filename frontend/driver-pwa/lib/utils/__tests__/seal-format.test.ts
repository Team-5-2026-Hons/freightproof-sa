import { describe, it, expect } from 'vitest'
import { isValidSealFormat, normalizeSeal } from '../seal-format'

// Mirrors backend _validate_seal_format (backend/app/schemas/phases.py) — these
// cases are exactly what the API accepts/422s, so client and server can't drift.
describe('isValidSealFormat', () => {
  it.each(['AB-1234', 'FP-0001', 'ZZ-9999'])('accepts %s', (seal) => {
    expect(isValidSealFormat(seal)).toBe(true)
  })

  it('accepts lowercase and padding after normalisation', () => {
    expect(isValidSealFormat(' ab-1234 ')).toBe(true)
  })

  it.each(['1234', 'FP1234', 'SEAL-7789-A', 'A-1234', 'ABC-1234', 'AB-123', 'AB-12345', ''])(
    'rejects %s',
    (seal) => {
      expect(isValidSealFormat(seal)).toBe(false)
    },
  )
})

// normalizeSeal is what callers must actually store and submit — isValidSealFormat
// passing on a raw value is meaningless if the value that reaches the API is a
// different, untrimmed string. See SealInput.tsx and SealVerify.tsx, both of which
// used to uppercase-only and submit an untrimmed value that could pass their own
// on-screen gate while still 422ing at the backend on a stray space.
describe('normalizeSeal', () => {
  it('trims and uppercases so the stored value matches what was validated', () => {
    expect(normalizeSeal(' ab-1234 ')).toBe('AB-1234')
  })

  it('is idempotent on an already-canonical seal', () => {
    expect(normalizeSeal('AB-1234')).toBe('AB-1234')
  })

  it('produces a value isValidSealFormat always accepts or always rejects consistently', () => {
    const raw = ' ab-1234 '
    expect(isValidSealFormat(normalizeSeal(raw))).toBe(isValidSealFormat(raw))
  })
})
