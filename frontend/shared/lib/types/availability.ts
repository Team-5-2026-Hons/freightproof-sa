// Mirrors backend app/schemas/availability.py (FP-139, FP-142): who is busy, on which trip,
// until when. One shape for the wizard's availability read and for a refused creation's
// 409 CREW_UNAVAILABLE body, so both describe a clash the same way.

import type { TripStatus } from './trip'

export type CrewResourceType = 'driver' | 'horse' | 'trailer'

export interface BusyEntry {
  resource_type: CrewResourceType
  resource_id: string
  label: string
  trip_id: string
  trip_reference: string
  trip_status: TripStatus
  busy_from: string
  busy_until: string | null
  planned_until: string | null
}

/** GET /api/v1/trips/availability */
export interface CrewAvailability {
  start: string
  end: string
  busy: BusyEntry[]
}
