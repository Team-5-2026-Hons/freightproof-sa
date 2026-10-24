import { api } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import type { TripRoute } from '@/lib/types/route'

export const fetchMyActiveTrip = (): Promise<Trip | null> => api.get<Trip | null>('/api/v1/trips/me/active')

// Every trip assigned to this driver, newest first, all statuses — the Trips list
// groups them into Active/Upcoming/Past by status.
export const fetchMyTrips = (): Promise<DriverTripSummary[]> =>
  api.get<DriverTripSummary[]>('/api/v1/trips/me')

// 404s on another driver's trip. Distinct from fetchMyActiveTrip: this addresses a trip
// explicitly, letting the driver open a not-yet-activated Upcoming trip.
export const fetchMyTrip = (tripId: string): Promise<Trip> =>
  api.get<Trip>(`/api/v1/trips/me/${tripId}`)

// The planned truck route through the trip's stops. null (not an error) when the server
// can't plan one — the driving screen then shows the planned arrival time instead.
export const fetchMyTripRoute = (tripId: string): Promise<TripRoute | null> =>
  api.get<TripRoute | null>(`/api/v1/trips/me/${tripId}/route`)
