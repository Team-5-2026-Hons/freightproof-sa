// Display rules for the analytics screen (FP-156 spec §4.5).
//
// Module-scoped and pure so the rules that keep these numbers honest are proven once in
// tests rather than re-implemented per column:
//   - a rate is never shown without the counts it came from: "67% (2/3)";
//   - no data (a null from the API, i.e. a zero denominator) reads "—", never "0%".

import { fmtDelay } from './schedule'

export const NO_DATA = '—'

const PERCENT = 100
const MINUTES_PER_HOUR = 60
// Exceptions per trip is a ratio, not a share: it can exceed 1, so it needs decimals.
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
