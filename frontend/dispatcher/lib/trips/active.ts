import type { TripStatus } from '@shared/lib/types/trip'

export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = ['created', 'active', 'exception_hold']

/** True for a trip that is neither closed nor cancelled. */
export function isActiveTrip(trip: { status: TripStatus }): boolean {
  return ACTIVE_TRIP_STATUSES.includes(trip.status)
}
