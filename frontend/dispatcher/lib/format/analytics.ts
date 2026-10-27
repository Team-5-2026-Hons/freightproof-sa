// Display rules for the analytics screen. A rate is never shown
// without the counts it came from ("67% (2/3)"), and no data reads "—", never "0%".

import { fmtDelay } from './schedule'

export const NO_DATA = '—'

const PERCENT = 100
const MINUTES_PER_HOUR = 60
const RATIO_DECIMALS = 2

/** "67% (2/3)". "—" when there is nothing to divide by: no observations is not 0%. */
export function fmtRate(rate: number | null, numerator: number, denominator: number): string {
  if (rate === null || denominator === 0) return NO_DATA
  return `${Math.round(rate * PERCENT)}% (${numerator}/${denominator})`
}

/** "1.50 (3/2)" for a per-trip ratio. "—" when there were no trips. */
export function fmtRatio(ratio: number | null, numerator: number, denominator: number): string {
  if (ratio === null || denominator === 0) return NO_DATA
  return `${ratio.toFixed(RATIO_DECIMALS)} (${numerator}/${denominator})`
}

/** "2 h 15 m" / "45 m", rounded to the minute. "—" when there were no observations. */
export function fmtMinutes(minutes: number | null): string {
  if (minutes === null) return NO_DATA
  const total = Math.round(minutes)
  const hours = Math.floor(total / MINUTES_PER_HOUR)
  const mins = total % MINUTES_PER_HOUR
  if (hours === 0) return `${mins} m`
  return mins > 0 ? `${hours} h ${mins} m` : `${hours} h`
}

/** Driving hours in the same "h m" form. Never null: a sum over no legs is 0. */
export function fmtHours(hours: number): string {
  return fmtMinutes(hours * MINUTES_PER_HOUR)
}

/** Actual minus planned: "20 m late" / "40 m early" / "On time". Same sign rule as the
 *  trip schedule (positive = late), so it reuses that formatter rather than restating it. */
export function fmtScheduleDelta(minutes: number | null): string {
  if (minutes === null) return NO_DATA
  return fmtDelay(Math.round(minutes))
}

/** A count that may be absent, e.g. a lowest streak before any incident. 0 is a real
 *  value and is shown as 0. */
export function fmtOptionalCount(count: number | null): string {
  return count === null ? NO_DATA : String(count)
}

const RAND_LOCALE = 'en-ZA'
const RAND_WHOLE = new Intl.NumberFormat(RAND_LOCALE, { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const RAND_CENTS = new Intl.NumberFormat(RAND_LOCALE, {
  style: 'currency', currency: 'ZAR', minimumFractionDigits: 2, maximumFractionDigits: 2,
})

/** A rand total, rounded to the rand. "—" when there is no figure. */
export function fmtRand(value: number | null): string {
  return value === null ? NO_DATA : RAND_WHOLE.format(value)
}

/** A rand rate, to the cent, e.g. "R 17,64". "—" when there is no figure. */
export function fmtRandRate(value: number | null): string {
  return value === null ? NO_DATA : RAND_CENTS.format(value)
}

const THOUSAND = 1_000
const MILLION = 1_000_000
const AXIS_AMOUNT = new Intl.NumberFormat(RAND_LOCALE, { maximumFractionDigits: 1 })

/** An axis tick for an amount: "0", "850", "50k", "160k", "1,2m". */
export function fmtAxisAmount(value: number): string {
  const size = Math.abs(value)
  if (size >= MILLION) return `${AXIS_AMOUNT.format(value / MILLION)}m`
  if (size >= THOUSAND) return `${AXIS_AMOUNT.format(value / THOUSAND)}k`
  return AXIS_AMOUNT.format(value)
}
