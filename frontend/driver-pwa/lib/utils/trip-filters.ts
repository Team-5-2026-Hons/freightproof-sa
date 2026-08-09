// Pure filtering/categorization utilities for the driver's trip list.
// No I/O, no React — consumed by the Trips-list page and Home page (separate tasks).
//
// Generic over the trip shape rather than fixed to @shared's Trip: the list page now
// reads DriverTripSummary rows from GET /trips/me, while demo mode and the Home page
// still pass full Trip objects. Each function constrains only the fields it actually
// reads, so both shapes satisfy it and neither is weakened.

import type { Trip } from '@shared/lib/types/trip'
import type { CoarseTripStatus } from '@shared/lib/types/phase'
import type { DriverId } from '@shared/lib/types/driver'

// A trip is "active" only once the DRIVER has activated it — completing the Activation
// phase is what flips the backend's coarse status from 'created' to 'active'
// (orchestration/phase_service.advance_activation). So 'created' is an assignment the
// dispatcher has made and the driver has not started: it belongs in Upcoming, never in
// Active. 'exception_hold' is still the trip the driver is on, just blocked from
// advancing, so it groups with Active.
const TERMINAL_STATUSES: readonly CoarseTripStatus[] = ['closed', 'cancelled']
const UPCOMING_STATUS: CoarseTripStatus = 'created'

export function tripsForDriver(trips: Trip[], driverId: DriverId): Trip[] {
  return trips.filter((t) => t.driver?.id === driverId)
}

export interface CategorizedTrips<T> {
  active: T[]
  upcoming: T[]
  past: T[]
}

// Minimum a row must carry to be grouped into a tab.
interface HasStatus {
  status: CoarseTripStatus
}

export function categorizeTrips<T extends HasStatus>(trips: readonly T[]): CategorizedTrips<T> {
  const active: T[] = []
  const upcoming: T[] = []
  const past: T[] = []

  for (const trip of trips) {
    if (TERMINAL_STATUSES.includes(trip.status)) {
      past.push(trip)
    } else if (trip.status === UPCOMING_STATUS) {
      upcoming.push(trip)
    } else {
      active.push(trip)
    }
  }

  return { active, upcoming, past }
}

export type DepartureOrder = 'soonest-first' | 'latest-first'

// Minimum a row must carry to be ordered by when it leaves.
interface HasDeparture {
  planned_departure_at: string | null
  actual_departure_at: string | null
}

// Orders trips by the departure the card actually displays, so the dates a driver reads
// down the list never run backwards. GET /trips/me returns rows in no guaranteed order,
// which is how a trip leaving on the 6th ended up above one leaving on the 5th.
//
// planned first, actual only as a fallback: planned is what the card shows, and a trip
// that left early would otherwise sort away from the time printed on it. A row with
// neither sinks to the bottom in BOTH directions — no departure means unscheduled, not
// "the beginning of time", and floating it to the top would bury the trip the driver is
// actually leaving on next.
export function sortByDeparture<T extends HasDeparture>(
  trips: readonly T[],
  order: DepartureOrder = 'soonest-first',
): T[] {
  const departureMs = (trip: T): number | null => {
    const at = trip.planned_departure_at ?? trip.actual_departure_at
    if (at === null) return null
    const ms = new Date(at).getTime()
    // A malformed timestamp sorts as unscheduled rather than poisoning the comparator
    // with NaN, which would leave the whole list in an arbitrary order.
    return Number.isNaN(ms) ? null : ms
  }

  // Copy, never sort in place: callers pass memoised arrays derived from React state.
  // Array.prototype.sort is stable (ES2019+), so trips sharing a departure keep the
  // order the server sent them in.
  return [...trips].sort((a, b) => {
    const aMs = departureMs(a)
    const bMs = departureMs(b)
    if (aMs === null) return bMs === null ? 0 : 1
    if (bMs === null) return -1
    return order === 'soonest-first' ? aMs - bMs : bMs - aMs
  })
}

export interface PastTripFilters {
  dateFrom: string | null // ISO date, inclusive
  dateTo: string | null // ISO date, inclusive
  search: string // matches origin/destination precinct name or id, case-insensitive
}

// Minimum a row must carry to be date-filtered and text-searched. Precinct names are
// optional so a full Trip (which has ids only) still satisfies the constraint.
interface PastTripFields {
  actual_arrival_at: string | null
  planned_arrival_at: string | null
  origin_precinct_id: string | null
  destination_precinct_id: string | null
  origin_precinct_name?: string | null
  destination_precinct_name?: string | null
}

export function filterPastTrips<T extends PastTripFields>(
  trips: readonly T[],
  filters: PastTripFilters,
): T[] {
  return trips.filter((trip) => {
    const reference = trip.actual_arrival_at ?? trip.planned_arrival_at
    // Compare epoch ms (not raw ISO strings) so non-Z UTC offsets (e.g. '+02:00') from the
    // backend compare correctly; bare dateFrom/dateTo are treated as UTC calendar days (known simplification).
    const referenceMs = reference ? new Date(reference).getTime() : null
    if (filters.dateFrom) {
      const fromMs = new Date(`${filters.dateFrom}T00:00:00.000Z`).getTime()
      if (referenceMs === null || referenceMs < fromMs) return false
    }
    if (filters.dateTo) {
      const toMs = new Date(`${filters.dateTo}T23:59:59.999Z`).getTime()
      if (referenceMs === null || referenceMs > toMs) return false
    }

    if (filters.search.trim() !== '') {
      const needle = filters.search.trim().toLowerCase()
      // Names first — a driver searching "Cape Town" means the depot, not a UUID. Ids stay
      // in the haystack so a row whose precinct name the server couldn't resolve is still
      // findable by the id the card falls back to displaying.
      const haystack = [
        trip.origin_precinct_name,
        trip.destination_precinct_name,
        trip.origin_precinct_id,
        trip.destination_precinct_id,
      ]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) return false
    }

    return true
  })
}
