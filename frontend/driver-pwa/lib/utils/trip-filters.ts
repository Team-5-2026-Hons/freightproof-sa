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
import type { DriverParticipation } from '@shared/lib/types/driver-substitution'

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

interface HasStatus {
  status: CoarseTripStatus
  participation?: DriverParticipation
}

const FORMER: DriverParticipation = 'former'

export function categorizeTrips<T extends HasStatus>(trips: readonly T[]): CategorizedTrips<T> {
  const active: T[] = []
  const upcoming: T[] = []
  const past: T[] = []

  for (const trip of trips) {
    if (trip.participation === FORMER || TERMINAL_STATUSES.includes(trip.status)) {
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

interface HasDeparture {
  planned_departure_at: string | null
  actual_departure_at: string | null
}

export function sortByDeparture<T extends HasDeparture>(
  trips: readonly T[],
  order: DepartureOrder = 'soonest-first',
): T[] {
  const departureMs = (trip: T): number | null => {
    const at = trip.planned_departure_at ?? trip.actual_departure_at
    if (at === null) return null
    const ms = new Date(at).getTime()
    return Number.isNaN(ms) ? null : ms
  }

  return [...trips].sort((a, b) => {
    const aMs = departureMs(a)
    const bMs = departureMs(b)
    if (aMs === null) return bMs === null ? 0 : 1
    if (bMs === null) return -1
    return order === 'soonest-first' ? aMs - bMs : bMs - aMs
  })
}

export interface PastTripFilters {
  dateFrom: string | null
  dateTo: string | null
  search: string
}

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
