import { describe, it, expect } from 'vitest'
import { isValidSealFormat } from '../seal-format'

// Mirrors backend _validate_seal_format (backend/app/schemas/handshakes.py) — these
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
