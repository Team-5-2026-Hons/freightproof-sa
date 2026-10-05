import { describe, expect, it } from 'vitest'

import { fmtCalendarDate, fmtSastDateParts, fmtSastDateTime } from '@shared/lib/utils/datetime'

// Lives beside the dispatcher's other format tests: the shared package has no test runner of its own.
describe('fmtSastDateParts', () => {
  it('returns the day and the time as separate strings, with no date/time separator in either', () => {
    const parts = fmtSastDateParts('2026-10-01T10:50:00Z')

    expect(parts).toEqual({ day: '01 Oct 2026', time: '12:50 SAST' })
    // Chrome's en-GB emits " at " between date and time; neither half may carry it.
    expect(parts?.day).not.toMatch(/,| at /)
    expect(parts?.time).not.toMatch(/,| at /)
  })

  it('rolls to the next SAST day at 22:00Z, not at midnight UTC', () => {
    expect(fmtSastDateParts('2026-09-05T21:59:00Z')).toEqual({ day: '05 Sep 2026', time: '23:59 SAST' })
    expect(fmtSastDateParts('2026-09-05T22:00:00Z')).toEqual({ day: '06 Sep 2026', time: '00:00 SAST' })
  })

  it('returns null for a missing or unparseable instant, so a cell can show a dash', () => {
    expect(fmtSastDateParts(null)).toBeNull()
    expect(fmtSastDateParts(undefined)).toBeNull()
    expect(fmtSastDateParts('not a date')).toBeNull()
  })
})

describe('fmtCalendarDate', () => {
  it('reads a date with no time as day, month and year, never moving the day', () => {
    expect(fmtCalendarDate('2027-09-23')).toBe('23 Sep 2027')
    expect(fmtCalendarDate('2026-01-01')).toBe('01 Jan 2026')
    expect(fmtCalendarDate('2026-12-31')).toBe('31 Dec 2026')
  })

  it('uses the same month wording as the date-and-time helper', () => {
    expect(fmtCalendarDate('2026-09-05')).toBe(fmtSastDateParts('2026-09-05T10:00:00Z')?.day)
  })

  it('returns null for a missing or malformed date', () => {
    expect(fmtCalendarDate(null)).toBeNull()
    expect(fmtCalendarDate('')).toBeNull()
    expect(fmtCalendarDate('not a date')).toBeNull()
    expect(fmtCalendarDate('2026-13-01')).toBeNull()
  })
})

describe('fmtSastDateTime', () => {
  it('joins the same day and time the stacked cells show, in SAST', () => {
    expect(fmtSastDateTime('2026-09-05T14:30:00Z')).toBe('05 Sep 2026, 16:30 SAST')
  })

  it('never differs from fmtSastDateParts, whatever the runtime date/time separator is', () => {
    const iso = '2026-10-01T10:50:00Z'
    const parts = fmtSastDateParts(iso)

    expect(fmtSastDateTime(iso)).toBe(`${parts?.day}, ${parts?.time}`)
    expect(fmtSastDateTime(iso)).not.toMatch(/ at /)
  })

  it('returns null for a missing or unparseable instant', () => {
    expect(fmtSastDateTime(null)).toBeNull()
    expect(fmtSastDateTime('not a date')).toBeNull()
  })
})
