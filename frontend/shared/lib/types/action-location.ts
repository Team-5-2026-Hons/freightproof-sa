// ActionLocationAssessment: a versioned, pure snapshot of one driver-vs-truck
// proximity check (Task 4 of the trip-location-timeline story), plus the
// precinct-membership facts evaluated alongside it. Mirrors backend
// ActionLocationAssessment in backend/app/schemas/action_location.py — keep both
// in lockstep; this shape is what preview, persistence and display all share.
//
// This describes what a server-side evaluation observed. It is never a client
// input: a client-constructed value of this shape is not authoritative evidence
// (see the backend module's docstring).
//
// UUID and datetime fields are `string` here (ISO 8601 / UUID text), matching
// how every other mirrored type in this directory (see checkpoint.ts, phase.ts)
// represents them on the wire.

export type ProximityVerdict = 'within_limit' | 'separated' | 'unverified'

export type ProximityReason =
  | 'missing_phone'
  | 'missing_tracker'
  | 'missing_time'
  | 'missing_accuracy'
  | 'poor_accuracy'
  | 'stale_fix'
  | 'time_skew'
  | 'future_fix'

export interface ActionLocationAssessment {
  schema_version: 1
  policy_version: string
  evaluated_at: string

  driver_lat: number | null
  driver_lng: number | null
  driver_captured_at: string | null
  driver_accuracy_metres: number | null

  tracker_lat: number | null
  tracker_lng: number | null
  tracker_captured_at: string | null

  separation_metres: number | null
  proximity: ProximityVerdict
  reasons: ProximityReason[]

  max_separation_metres: number
  max_age_seconds: number
  max_skew_seconds: number
  max_phone_accuracy_metres: number

  expected_trip_stop_id: string | null
  precinct_id: string | null
  precinct_lat: number | null
  precinct_lng: number | null
  precinct_radius_metres: number | null
  precinct_tolerance_metres: number | null
  driver_in_precinct: boolean | null
  truck_in_precinct: boolean | null
}

// DriverLocationCapture: the driver phone's own GPS reading at capture time.
// Needed by Task 6 to carry a live capture (from the driver-pwa) through to the
// point an ActionLocationAssessment is assembled, before anything is persisted.
export interface DriverLocationCapture {
  lat: number | null
  lng: number | null
  accuracy_metres: number | null
  captured_at: string
}
