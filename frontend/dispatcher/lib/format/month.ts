// Calendar-month arithmetic for the analytics month range (FP-156).
//
// The analytics views bucket trips by calendar month in SAST (FP-153 Q4), so "this month"
// is read from the Africa/Johannesburg calendar by named zone — not the browser's local
// calendar, which on a machine set to UTC still shows last month for the first two hours
// of the 1st. Same approach as the history page's todayStr().
//
// Months are "YYYY-MM-01" strings throughout: zero-padded, so they also sort
// chronologically as plain strings.

import type { MonthRange } from '@/lib/types/month-range'

const OPERATIONS_TIME_ZONE = 'Africa/Johannesburg'
const MONTHS_PER_YEAR = 12
const MONTH_DIGITS = 2

/** The default range: the current month and the two before it. */
export const DEFAULT_RANGE_MONTHS = 3

const OPERATIONS_MONTH_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPERATIONS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
})

/** "YYYY-MM-01" for a 1-based month number. */
export function toMonth(year: number, monthNumber: number): string {
  return `${year}-${String(monthNumber).padStart(MONTH_DIGITS, '0')}-01`
}

/** { year, month } (1-based) of a "YYYY-MM-01" string. */
export function parseMonth(month: string): { year: number; month: number } {
  const [year, monthNumber] = month.split('-').map(Number)
  return { year, month: monthNumber }
}

/** The operations-calendar (SAST) month containing `now`. */
export function operationsMonth(now: Date = new Date()): string {
  const parts = OPERATIONS_MONTH_FORMATTER.formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (!year || !month) throw new Error('Unable to resolve operations month')
  return toMonth(Number(year), Number(month))
}

/** Shift a month by `count` months; negative is earlier. */
export function addMonths(month: string, count: number): string {
  const { year, month: monthNumber } = parseMonth(month)
  const index = year * MONTHS_PER_YEAR + (monthNumber - 1) + count
  return toMonth(Math.floor(index / MONTHS_PER_YEAR), (index % MONTHS_PER_YEAR) + 1)
}

/** The current SAST month and the DEFAULT_RANGE_MONTHS - 1 months before it. */
export function defaultMonthRange(now: Date = new Date()): MonthRange {
  const end = operationsMonth(now)
  return { start: addMonths(end, -(DEFAULT_RANGE_MONTHS - 1)), end }
}

// Fixed rather than Intl: some locales abbreviate September as "Sept", and the label should
// read the same in every browser.
export const MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function fmtMonth({ year, month }: { year: number; month: number }): string {
  return `${MONTH_ABBREVIATIONS[month - 1]} ${year}`
}

/** "Sep 2026" for one month, "Jul – Sep 2026" within a year, "Nov 2025 – Jan 2026" across
 *  a year boundary. */
export function fmtMonthRange(range: MonthRange): string {
  const start = parseMonth(range.start)
  const end = parseMonth(range.end)
  if (range.start === range.end) return fmtMonth(end)
  const startLabel = start.year === end.year ? MONTH_ABBREVIATIONS[start.month - 1] : fmtMonth(start)
  return `${startLabel} – ${fmtMonth(end)}`
}
