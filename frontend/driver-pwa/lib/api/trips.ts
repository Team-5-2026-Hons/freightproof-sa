import { api } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import type { TripRoute } from '@/lib/types/route'

export const fetchMyActiveTrip = (): Promise<Trip | null> => api.get<Trip | null>('/api/v1/trips/me/active')

export const fetchMyTrips = (): Promise<DriverTripSummary[]> =>
  api.get<DriverTripSummary[]>('/api/v1/trips/me')

export const fetchMyTrip = (tripId: string): Promise<Trip> =>
  api.get<Trip>(`/api/v1/trips/me/${tripId}`)

export const fetchMyTripRoute = (tripId: string): Promise<TripRoute | null> =>
  api.get<TripRoute | null>(`/api/v1/trips/me/${tripId}/route`)
