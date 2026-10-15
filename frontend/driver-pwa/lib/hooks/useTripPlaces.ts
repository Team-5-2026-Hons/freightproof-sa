'use client'

import type { Trip } from '@shared/lib/types/trip'
import { useMyTrips } from '@/lib/hooks/useMyTrips'
import { knownPrecinctName } from '@/lib/utils/precinct-name'
import { placeParts, type PlaceParts } from '@/lib/utils/trip-display'

export interface TripPlaces {
  origin: PlaceParts
  destination: PlaceParts
}

/**
 * Place names for a trip. The full Trip carries only precinct ids, so names come from the
 * driver's trip list (the server resolves them there), then the local lookup, and
 * otherwise the stop's role — never an id fragment.
 */
export function useTripPlaces(trip: Trip): TripPlaces {
  const { trips } = useMyTrips()
  const summary = trips.find((t) => String(t.id) === String(trip.id))
  const resolve = (name: string | null | undefined, id: string, role: string): PlaceParts => {
    const known = name ?? knownPrecinctName(id)
    return known === null ? { name: role, detail: null } : placeParts(known)
  }
  return {
    origin: resolve(summary?.origin_precinct_name, trip.origin_precinct_id, 'Origin'),
    destination: resolve(summary?.destination_precinct_name, trip.destination_precinct_id, 'Destination'),
  }
}
