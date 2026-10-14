// Mirrors backend schemas/trip_routes.py (GET /api/v1/trips/me/{trip_id}/route).
// A display aid, not evidence: nothing here is hashed, anchored or submitted.

/** [lat, lng] — lat-first, like everything else in this app. */
export type RouteCoordinate = [number, number]

export interface TripRouteLeg {
  /** TripStop.sequence of the stop this leg leaves, matching an in_transit row's stop_sequence. */
  from_stop_sequence: number
  to_stop_sequence: number
  distance_metres: number
  duration_seconds: number
  coordinates: RouteCoordinate[]
}

export interface TripRoute {
  trip_id: string
  provider: 'openrouteservice'
  profile: 'driving-hgv'
  distance_metres: number
  duration_seconds: number
  legs: TripRouteLeg[]
  computed_at: string
}
