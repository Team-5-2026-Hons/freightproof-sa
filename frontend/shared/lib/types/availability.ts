// Mirrors backend app/schemas/availability.py (FP-139, FP-142): who is busy, on which trip,
// until when. One shape for the wizard's availability read and for a refused creation's
// 409 CREW_UNAVAILABLE body, so both describe a clash the same way.

import type { TripStatus } from './trip'

export type CrewResourceType = 'driver' | 'horse' | 'trailer'

export interface BusyEntry {
  resource_type: CrewResourceType
  resource_id: string
  /** Driver full name or vehicle registration. */
  label: string
  trip_id: string
  trip_reference: string
  trip_status: TripStatus
  busy_from: string
  /** null: busy until that trip is closed or cancelled (a live trip past its planned end,
   *  or an old trip with no planned arrival). No time can be promised for those. */
  busy_until: string | null
  /** The planned end, kept when busy_until is null so the screen can say "was due …". */
  planned_until: string | null
}

/** GET /api/v1/trips/availability */
export interface CrewAvailability {
  start: string
  end: string
  busy: BusyEntry[]
}
