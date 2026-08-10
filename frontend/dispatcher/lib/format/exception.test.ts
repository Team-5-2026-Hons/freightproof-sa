import { describe, expect, it } from 'vitest'
import { fmtExceptionType } from './exception'

describe('fmtExceptionType', () => {
  it('title-cases every word of a snake_case enum', () => {
    expect(fmtExceptionType('waybill_count_mismatch')).toBe('Waybill Count Mismatch')
  })

  it('handles a single-word type', () => {
    expect(fmtExceptionType('mechanical')).toBe('Mechanical')
  })

  it('handles the two-word driver types', () => {
    expect(fmtExceptionType('panic_button')).toBe('Panic Button')
    expect(fmtExceptionType('seal_broken_in_transit')).toBe('Seal Broken In Transit')
  })
})
