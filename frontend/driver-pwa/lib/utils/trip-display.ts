// Presentation helpers for trips on Home, Trips and the trip page. Pure
// functions over the API shapes, so every screen words a trip the same way.

import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { precinctName } from '@/lib/utils/precinct-name'

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60

// Precinct names arrive as "FedEx JHB · Linbro Park": the place a driver says, then the
// area. Rows and titles lead with the place and put the area underneath.
const PLACE_SEPARATOR = ' · '

// The server resolves precinct names; demo rows and a deleted precinct fall back to the
// local lookup, then to a plain label — never a truncated UUID.
export function placeOf(name: string | null, id: string | null): string {
  if (name !== null) return name
  return id !== null ? precinctName(id) : 'Unknown'
}

export interface PlaceParts {
  name: string
  detail: string | null
}

export function placeParts(fullName: string): PlaceParts {
  const at = fullName.indexOf(PLACE_SEPARATOR)
  if (at < 0) return { name: fullName, detail: null }
  return { name: fullName.slice(0, at), detail: fullName.slice(at + PLACE_SEPARATOR.length) }
}

/** "10 h 45" between two instants; null unless both are known. */
export function durationLabel(startIso: string | null, endIso: string | null): string | null {
  if (startIso === null || endIso === null) return null
  const minutes = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / MS_PER_MINUTE))
  const h = Math.floor(minutes / MINUTES_PER_HOUR)
  const m = minutes % MINUTES_PER_HOUR
  return `${h} h ${String(m).padStart(2, '0')}`
}

export type OutcomeTone = 'success' | 'attention' | 'neutral'

export interface PastOutcome {
  tone: OutcomeTone
  text: string
}

/**
 * How a finished trip ended, in one line. An open review outranks timeliness (it is the
 * thing the driver may still be asked about). Late is neutral, not red: lateness is a
 * fact on the record, not a fault the app should shout. Same "on time" rule as the Home
 * record (lib/utils/driver-record): arrived by the planned time, no grace.
 */
export function pastOutcome(trip: DriverTripSummary): PastOutcome {
  if (trip.status === 'cancelled') return { tone: 'neutral', text: 'Cancelled' }
  // Before the delivery checks: a driver who handed the load over did not deliver it —
  // even once the trip closes — and it may not have arrived yet. The delivery outcome
  // belongs to whoever finished it; this row only records that this driver's part ended.
  if (trip.participation === 'former') {
    return { tone: 'neutral', text: 'Handed over' }
  }
  if (trip.needs_review_count > 0) {
    const n = trip.needs_review_count
    return { tone: 'attention', text: `Under review · ${n} exception${n === 1 ? '' : 's'}` }
  }
  if (trip.planned_arrival_at === null || trip.actual_arrival_at === null) {
    return { tone: 'neutral', text: 'Delivered' }
  }
  const lateBy = Math.round((Date.parse(trip.actual_arrival_at) - Date.parse(trip.planned_arrival_at)) / MS_PER_MINUTE)
  if (lateBy <= 0) return { tone: 'success', text: 'Delivered on time' }
  const late = lateBy < MINUTES_PER_HOUR ? `${lateBy} min` : durationLabel(trip.planned_arrival_at, trip.actual_arrival_at)
  return { tone: 'neutral', text: `Delivered · ${late} late` }
}

// Built on first use, not at import: this module is on every screen's load path and the
// two formatters were a measurable slice of the cold-start module-evaluation task (see
// lib/utils/format-time.ts for the same reasoning).
let weekdayFormat: Intl.DateTimeFormat | null = null
let dayFormat: Intl.DateTimeFormat | null = null

/** The date tile on a trip row: "SAT" over "9". Null for an unscheduled trip. */
export function dayTile(iso: string | null): { weekday: string; day: string } | null {
  if (iso === null) return null
  weekdayFormat ??= new Intl.DateTimeFormat('en-ZA', { weekday: 'short' })
  dayFormat ??= new Intl.DateTimeFormat('en-ZA', { day: 'numeric' })
  const date = new Date(iso)
  return { weekday: weekdayFormat.format(date).toUpperCase().replace('.', ''), day: String(Number(dayFormat.format(date))) }
}

// Built on first use, like the tile formatters above.
let monthFormat: Intl.DateTimeFormat | null = null
function monthLabel(iso: string): string {
  monthFormat ??= new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' })
  return monthFormat.format(new Date(iso))
}
const UNSCHEDULED = 'Unscheduled'

export interface MonthGroup {
  label: string
  trips: DriverTripSummary[]
}

/**
 * Consecutive trips grouped under "May 2026" headings for the full Past list. Keeps the caller's order — the list is already most-recent-first — so this only
 * inserts headings; trips with no departure at all land in a final "Unscheduled" group.
 */
export function groupByMonth(trips: readonly DriverTripSummary[]): MonthGroup[] {
  const groups: MonthGroup[] = []
  const unscheduled: DriverTripSummary[] = []
  for (const trip of trips) {
    const at = trip.planned_departure_at ?? trip.actual_departure_at
    if (at === null) {
      unscheduled.push(trip)
      continue
    }
    const label = monthLabel(at)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.trips.push(trip)
    else groups.push({ label, trips: [trip] })
  }
  if (unscheduled.length > 0) groups.push({ label: UNSCHEDULED, trips: unscheduled })
  return groups
}
