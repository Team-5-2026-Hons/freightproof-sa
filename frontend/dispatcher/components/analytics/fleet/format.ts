// Display helpers shared by the fleet Analytics tabs. Fleet-only on purpose: the detail pages
// format their own numbers through lib/format/analytics.ts, and nothing here changes those.

import { NO_DATA } from '@/lib/format/analytics'
import { fmtBucketRange, partialLabel } from '@/lib/format/period'
import type { Grain } from '@shared/lib/types/fleet-analytics'

const PERCENT = 100

/** "82%". "—" when there was nothing to divide by: no observations is not 0%. */
export function fmtShare(rate: number | null): string {
  return rate === null ? NO_DATA : `${Math.round(rate * PERCENT)}%`
}

/** A bucket's full name for tooltips and tables: "14–20 Sep 2026 (so far)" for a partial
 *  bucket, "7–13 Sep 2026" otherwise. Axis ticks use the shorter fmtBucketLabel (spec §7.7). */
export function fmtBucketName(start: string, isPartial: boolean, grain: Grain, today: string): string {
  const label = fmtBucketRange(start, grain)
  return isPartial ? `${label} (${partialLabel(start, grain, today)})` : label
}

/** The total of one number across rows, e.g. every bucket's trips for a chart's basis line. */
export function sumOf<Row>(rows: readonly Row[], value: (row: Row) => number): number {
  return rows.reduce((total, row) => total + value(row), 0)
}

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440

/** A step's typical time, as the step tiles show it (spec §5.2): "48 min", "6 h 10 min",
 *  "3 d 2 h". Rounded to the minute; a zero part is left out ("2 h", "3 d"). "—" for no data. */
export function fmtDuration(minutes: number | null): string {
  if (minutes === null) return NO_DATA
  const total = Math.round(Math.abs(minutes))
  if (total < MINUTES_PER_HOUR) return `${total} min`
  if (total < MINUTES_PER_DAY) {
    const hours = Math.floor(total / MINUTES_PER_HOUR)
    const rest = total % MINUTES_PER_HOUR
    return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
  }
  const days = Math.floor(total / MINUTES_PER_DAY)
  const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
  return hours > 0 ? `${days} d ${hours} h` : `${days} d`
}
