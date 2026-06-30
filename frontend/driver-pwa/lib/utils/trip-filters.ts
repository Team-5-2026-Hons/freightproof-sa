// Pure filtering/categorization utilities for the driver's trip list.
// No I/O, no React — consumed by the Trips-list page and Home page (separate tasks).

import type { Trip } from '@shared/lib/types/trip'
import type { DriverId } from '@shared/lib/types/driver'

// "Active" here is a display grouping only — it reflects the existing
// TripStatus state machine (a driver has at most one non-terminal,
// non-'created' trip at a time in practice). No new enforcement is added.
const TERMINAL_STATUSES: Trip['status'][] = ['closed', 'cancelled']

export function tripsForDriver(trips: Trip[], driverId: DriverId): Trip[] {
  return trips.filter((t) => t.driver?.id === driverId)
}

export interface CategorizedTrips {
  active: Trip[]
  upcoming: Trip[]
  past: Trip[]
}

export function categorizeTrips(trips: Trip[]): CategorizedTrips {
  const active: Trip[] = []
  const upcoming: Trip[] = []
  const past: Trip[] = []

  for (const trip of trips) {
    if (TERMINAL_STATUSES.includes(trip.status)) {
      past.push(trip)
    } else if (trip.status === 'created') {
      upcoming.push(trip)
    } else {
      active.push(trip)
    }
  }

  return { active, upcoming, past }
}

export interface PastTripFilters {
  dateFrom: string | null // ISO date, inclusive
  dateTo: string | null // ISO date, inclusive
  search: string // matches origin/destination precinct id, case-insensitive
}

export function filterPastTrips(trips: Trip[], filters: PastTripFilters): Trip[] {
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
      const haystack = `${trip.origin_precinct_id} ${trip.destination_precinct_id}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }

    return true
  })
}
