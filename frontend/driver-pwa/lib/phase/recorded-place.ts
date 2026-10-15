import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import { knownPrecinctName } from '@/lib/utils/precinct-name'
import { placeParts } from '@/lib/utils/trip-display'
import { phaseLocation } from './stop-label'

/**
 * Where a phase was recorded, for its receipt ("10:02 · Linbro Park", overhaul 5.4): the
 * area of the origin or destination precinct. Null for intermediate stops and for any
 * precinct this phone can't name — a receipt says nothing rather than print an id.
 */
export function recordedPlace(trip: Trip, phase: PhaseDescriptor): string | null {
  const where = phaseLocation(trip.phases, phase)
  const precinctId = where === 'Origin' ? trip.origin_precinct_id
    : where === 'Destination' ? trip.destination_precinct_id
      : null
  if (precinctId === null) return null
  const name = knownPrecinctName(precinctId)
  if (name === null) return null
  const { name: short, detail } = placeParts(name)
  return detail ?? short
}
