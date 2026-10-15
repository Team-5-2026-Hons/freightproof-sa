// The driver's record, computed from their own trips (GET /trips/me) — the same rows the
// Trips tabs list. Evidence, not opinion: every number is a count of something the ledger
// recorded, so a driver can trace each one back to trips they can open. There is no
// rating anyone assigns.

import type { DriverTripSummary } from '@/lib/types/driver-trip'

// A delivered trip. Cancelled trips never reached the receiver, so they count toward
// neither the completed total nor the on-time rate.
const COMPLETED_STATUS: DriverTripSummary['status'] = 'closed'

export interface DriverRecord {
  /** Trips closed out with the receiver. */
  completed: number
  /** Of the completed trips that carry both times, the share that arrived by the planned
   *  arrival time (0–1); null when none can be judged, so the UI says so instead of 0%. */
  onTimeRate: number | null
  /** Unreviewed critical exceptions across all the driver's trips (needs_review_count). */
  underReview: number
}

function arrivedByPlan(trip: DriverTripSummary): boolean | null {
  if (trip.planned_arrival_at === null || trip.actual_arrival_at === null) return null
  const planned = Date.parse(trip.planned_arrival_at)
  const actual = Date.parse(trip.actual_arrival_at)
  if (Number.isNaN(planned) || Number.isNaN(actual)) return null
  // No grace window: any tolerance would be a policy number nobody has agreed on, so the
  // card states the strict fact — on or before the time the dispatcher planned.
  return actual <= planned
}

export function driverRecord(trips: readonly DriverTripSummary[]): DriverRecord {
  const completedTrips = trips.filter((t) => t.status === COMPLETED_STATUS)
  const judged = completedTrips.map(arrivedByPlan).filter((v): v is boolean => v !== null)
  return {
    completed: completedTrips.length,
    onTimeRate: judged.length === 0 ? null : judged.filter(Boolean).length / judged.length,
    underReview: trips.reduce((sum, t) => sum + t.needs_review_count, 0),
  }
}
