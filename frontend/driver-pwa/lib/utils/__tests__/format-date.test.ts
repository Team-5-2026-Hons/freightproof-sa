import { describe, it, expect } from 'vitest'
import { formatDate, formatLongDate } from '../format-time'

describe('formatDate', () => {
  it('test_formats_a_calendar_date_day_month_year', () => {
    expect(formatDate('2027-03-12')).toBe('12 Mar 2027')
  })

  it('test_does_not_shift_a_date_only_value_across_midnight', () => {
    // A licence expiry is a calendar date, not an instant: "2027-01-01" must never read
    // as 31 Dec 2026 on a phone west of UTC.
    expect(formatDate('2027-01-01')).toBe('1 Jan 2027')
  })
})

describe('formatLongDate', () => {
  it('test_reads_weekday_day_month_like_a_heading', () => {
    expect(formatLongDate(new Date(2026, 4, 9))).toBe('Saturday 9 May')
  })
})
