import { describe, expect, it } from 'vitest'
import { addMonths, defaultMonthRange, operationsMonth, parseMonth, toMonth } from './month'

describe('operationsMonth', () => {
  it('reads the month from the SAST calendar, not UTC', () => {
    // 23:30 UTC on 31 August is already 01:30 SAST on 1 September. A UTC browser
    // calendar would still say August — the bug this module exists to avoid.
    expect(operationsMonth(new Date('2026-08-31T23:30:00Z'))).toBe('2026-09-01')
  })

  it('stays in the month until SAST midnight', () => {
    expect(operationsMonth(new Date('2026-09-30T21:59:00Z'))).toBe('2026-09-01')
    expect(operationsMonth(new Date('2026-09-30T22:00:00Z'))).toBe('2026-10-01')
  })
})

describe('addMonths', () => {
  it('moves backwards across a year boundary', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
  })

  it('moves forwards across a year boundary', () => {
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01')
  })
})

describe('defaultMonthRange', () => {
  it('covers the current SAST month and the two before it', () => {
    expect(defaultMonthRange(new Date('2026-09-11T10:00:00Z')))
      .toEqual({ start: '2026-07-01', end: '2026-09-01' })
  })

  it('reaches into the previous year early in the year', () => {
    expect(defaultMonthRange(new Date('2026-02-10T10:00:00Z')))
      .toEqual({ start: '2025-12-01', end: '2026-02-01' })
  })

  it('only ever produces first-of-month dates', () => {
    const range = defaultMonthRange(new Date('2026-09-11T10:00:00Z'))

    expect(range.start).toMatch(/^\d{4}-\d{2}-01$/)
    expect(range.end).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe('toMonth / parseMonth', () => {
  it('round-trip a zero-padded month', () => {
    expect(toMonth(2026, 7)).toBe('2026-07-01')
    expect(parseMonth('2026-07-01')).toEqual({ year: 2026, month: 7 })
  })
})
