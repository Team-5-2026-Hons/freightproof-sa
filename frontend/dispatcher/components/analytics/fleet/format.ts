// Display helpers shared by the fleet Analytics tabs. Detail pages format their own numbers
// through lib/format/analytics.ts.

import { NO_DATA } from '@/lib/format/analytics'
import { fmtBucketRange, partialLabel } from '@/lib/format/period'
import type { Grain } from '@shared/lib/types/fleet-analytics'

const PERCENT = 100

/** "82%", or "—" when there was nothing to divide by. */
export function fmtShare(rate: number | null): string {
  return rate === null ? NO_DATA : `${Math.round(rate * PERCENT)}%`
}

/** A bucket's full name for tooltips and tables, e.g. "14–20 Sep 2026 (so far)". */
export function fmtBucketName(start: string, isPartial: boolean, grain: Grain, today: string): string {
  const label = fmtBucketRange(start, grain)
  return isPartial ? `${label} (${partialLabel(start, grain, today)})` : label
}

/** The total of one number across rows. */
export function sumOf<Row>(rows: readonly Row[], value: (row: Row) => number): number {
  return rows.reduce((total, row) => total + value(row), 0)
}

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440

/** A step's typical time, e.g. "48 min", "6 h 10 min", "3 d 2 h", or "—" for no data. */
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
