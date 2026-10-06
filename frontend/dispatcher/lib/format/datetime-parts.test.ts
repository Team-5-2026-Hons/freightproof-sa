import { describe, expect, it } from 'vitest'

import {
  fmtCalendarDate, fmtDateTime, fmtFull, fmtSastDateParts, fmtSastDateTime, fmtTime, sastCalendarDay, sastToday,
} from '@shared/lib/utils/datetime'

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

// 14:30Z is 16:30 SAST. Every formatter below is a shape over the same SAST core.
describe('the shared formatters agree', () => {
  const ISO = '2026-09-05T14:30:00Z'

  it('shows the compact, time-only and full shapes in SAST, all saying so', () => {
    expect(fmtDateTime(ISO)).toBe('05 Sep, 16:30 SAST')
    expect(fmtTime(ISO)).toBe('16:30 SAST')
    expect(fmtFull(ISO)).toBe('05 Sep 2026, 16:30 SAST')
  })

  it('never prints "Sept", whatever the runtime locale data says', () => {
    for (const text of [fmtDateTime(ISO), fmtFull(ISO), fmtSastDateTime(ISO) ?? '', fmtCalendarDate('2026-09-05') ?? '']) {
      expect(text).toContain('Sep')
      expect(text).not.toContain('Sept')
    }
  })

  it('does not move with the viewer: 22:00Z is already the next day in SAST', () => {
    expect(fmtFull('2026-09-05T22:00:00Z')).toBe('06 Sep 2026, 00:00 SAST')
    expect(fmtDateTime('2026-09-05T21:59:00Z')).toBe('05 Sep, 23:59 SAST')
  })

  it('reads the full form exactly as the stacked cells do', () => {
    const parts = fmtSastDateParts(ISO)

    expect(fmtFull(ISO)).toBe(`${parts?.day}, ${parts?.time}`)
  })

  it('shows a dash for a missing or unreadable instant, never "Invalid Date"', () => {
    for (const bad of [null, undefined, '', 'garbage']) {
      expect(fmtDateTime(bad)).toBe('—')
      expect(fmtTime(bad)).toBe('—')
      expect(fmtFull(bad)).toBe('—')
    }
  })
})

describe('sastCalendarDay', () => {
  it('rolls to the next SAST day at 22:00Z, not at midnight UTC', () => {
    expect(sastCalendarDay('2026-10-05T21:59:00Z')).toBe('2026-10-05')
    expect(sastCalendarDay('2026-10-05T22:00:00Z')).toBe('2026-10-06')
  })

  it('returns null for an unparseable instant', () => {
    expect(sastCalendarDay('not a date')).toBeNull()
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(sastCalendarDay(new Date('2026-10-05T22:00:00Z'))).toBe('2026-10-06')
  })
})

describe('sastToday', () => {
  it('is the SAST calendar day of the current instant', () => {
    expect(sastToday()).toBe(sastCalendarDay(new Date()))
  })
})
