import type { TripStatus } from '@shared/lib/types/trip'

// Coarse: `active` is every trip between creation and closure. The old list enumerated six
// per-step statuses from the pre-phase model that no longer exist, so every advanced trip
// silently disappeared from the dashboard.
// `exception_hold` currently matches nothing — no backend path sets it (see
// orchestration/phase_service.py's _is_resolved). Kept so a held trip would appear here by
// default if a manual dispatcher hold lands, rather than vanishing the way the pre-phase
// statuses did.
export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = ['created', 'active', 'exception_hold']

/** True for a trip that is neither closed nor cancelled. */
export function isActiveTrip(trip: { status: TripStatus }): boolean {
  return ACTIVE_TRIP_STATUSES.includes(trip.status)
}
