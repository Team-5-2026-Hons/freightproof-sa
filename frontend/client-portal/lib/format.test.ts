import { describe, expect, it } from 'vitest'
import { formatCoord, formatRand, formatSast, humanise, pluralise } from './format'

describe('formatSast', () => {
  it('shows UTC instants in South African time', () => {
    expect(formatSast('2026-09-12T12:32:00Z')).toBe('12 Sep 2026 14:32 SAST')
  })

  it('shows a dash for a missing time', () => {
    expect(formatSast(null)).toBe('—')
  })

  it.each([['not a date'], ['2026-13-45T99:99:99Z'], ['12:32']])('shows a dash instead of throwing for the unparsable time %j', (value) => {
    expect(formatSast(value)).toBe('—')
  })

  it('honours the offset in the source string', () => {
    expect(formatSast('2026-09-12T14:32:00+02:00')).toBe('12 Sep 2026 14:32 SAST')
  })
})

describe('pluralise', () => {
  it('agrees the noun with the count', () => {
    expect(pluralise(1, 'record')).toBe('1 record')
    expect(pluralise(0, 'record')).toBe('0 records')
    expect(pluralise(3, 'late-evidence item')).toBe('3 late-evidence items')
    expect(pluralise(2, 'category', 'categories')).toBe('2 categories')
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
