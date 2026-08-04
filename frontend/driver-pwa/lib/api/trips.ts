// frontend/driver-pwa/lib/api/trips.ts
import { api } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

// The five completeH1..completeH5 handshake-complete calls that used to live here are
// gone — the backend's fixed-5-handshake routes (/handshakes/h{n}/complete) are
// deleted server-side, replaced by the single plan-driven
// POST /trips/{id}/phases/{phase_event_id}/complete in lib/api/phases.ts
// (completePhase/submitPhase). This file now only holds trip-level reads.
export const fetchMyActiveTrip = (): Promise<Trip | null> => api.get<Trip | null>('/api/v1/trips/me/active')

// Every trip assigned to this driver, newest first, all statuses — the Trips list groups
// them into Active/Upcoming/Past by status. Replaces the mock fixtures the Upcoming and
// Past tabs read before this endpoint existed, which could only ever match a mock
// driver UUID and so rendered both tabs empty for a real signed-in driver.
export const fetchMyTrips = (): Promise<DriverTripSummary[]> =>
  api.get<DriverTripSummary[]>('/api/v1/trips/me')

// Full detail for one of the driver's OWN trips. 404s on another driver's trip, so this
// is safe to call with any id the list handed us. Distinct from fetchMyActiveTrip: this
// addresses a trip explicitly, which is what lets the driver open a not-yet-activated
// Upcoming trip instead of only ever seeing whichever trip the server picks as current.
export const fetchMyTrip = (tripId: string): Promise<Trip> =>
  api.get<Trip>(`/api/v1/trips/me/${tripId}`)
