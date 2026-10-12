import { describe, expect, it } from 'vitest'
import { formatCoord, formatRand, formatSast, humanise } from './format'

describe('formatSast', () => {
  it('shows UTC instants in South African time', () => {
    expect(formatSast('2026-09-12T12:32:00Z')).toBe('12 Sep 2026 14:32 SAST')
  })

  it('shows a dash for a missing time', () => {
    expect(formatSast(null)).toBe('—')
  })
})

describe('humanise', () => {
  it('turns snake_case into a sentence-case label', () => {
    expect(humanise('panic_button')).toBe('Panic button')
  })
})

describe('formatCoord', () => {
  it('prints five decimal places and accuracy when known', () => {
    expect(formatCoord({ lat: -28.27261, lng: 29.129412, source: 'driver_phone', recorded_at: null, accuracy_metres: 12.5 }))
      .toBe('-28.27261, 29.12941 (±13 m)')
  })
})

describe('formatRand', () => {
  it('prints rand the same way the PDF does', () => {
    expect(formatRand('125000.00')).toBe('R 125,000.00')
  })

  it('says when no value was declared', () => {
    expect(formatRand(null)).toBe('not declared')
  })
})
