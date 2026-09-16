import { api } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

export const fetchMyActiveTrip = (): Promise<Trip | null> => api.get<Trip | null>('/api/v1/trips/me/active')

// Every trip assigned to this driver, newest first, all statuses — the Trips list
// groups them into Active/Upcoming/Past by status.
export const fetchMyTrips = (): Promise<DriverTripSummary[]> =>
  api.get<DriverTripSummary[]>('/api/v1/trips/me')

// 404s on another driver's trip. Distinct from fetchMyActiveTrip: this addresses a trip
// explicitly, letting the driver open a not-yet-activated Upcoming trip.
export const fetchMyTrip = (tripId: string): Promise<Trip> =>
  api.get<Trip>(`/api/v1/trips/me/${tripId}`)
