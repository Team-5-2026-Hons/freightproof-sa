// Trip: the primary freight movement record, progressed through five handshakes.
// Mirrors backend TripRead schema in schemas/trips.py.

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { HandshakeEvent } from './handshake'
import type { TripException } from './exception'

export type TripId = string & { readonly __brand: 'TripId' }

// Mirrors backend TripStatus exactly — 10 states, no simplification.
// The driver app routes to different screens depending on which of these is active.
export type TripStatus =
  | 'created'          // Dispatcher created the trip; driver not yet gate-in at origin
  | 'origin_gate_in'   // H1 in progress — guard is verifying at origin gate
  | 'loading'          // H2 in progress — warehouse is scanning parcels onto vehicle
  | 'origin_gate_out'  // H3 in progress — guard is sealing and releasing at origin gate
  | 'in_transit'       // Vehicle is on the road between origin and destination
  | 'dest_gate_in'     // H4 in progress — guard is verifying at destination gate
  | 'unloading'        // H5 in progress — warehouse is scanning parcels off vehicle
  | 'closed'           // All 5 handshakes completed successfully
  | 'cancelled'        // Trip was cancelled before completion
  | 'exception_hold'   // Trip is paused pending resolution of a critical exception

// Lightweight shape for list views. All IDs only — no nested objects.
export interface TripSummary {
  id: TripId
  trip_reference: string
  order_number: string
  status: TripStatus
  planned_departure_at: string | null
  created_at: string
}

// Full trip detail used by useTrip(). Nested objects confirmed by backend teammate.
// trailers: to be added to TripRead by backend; agreed shape is list[VehicleRead].
// handshake_events and exceptions: expected additions to TripRead before Phase 1 wires up.
export interface Trip {
  id: TripId
  trip_reference: string
  order_number: string
  status: TripStatus
  operator_organization_id: string
  client_organization_id: string
  driver_id: string
  horse_id: string
  origin_precinct_id: string
  destination_precinct_id: string
  created_by_user_id: string
  pulsit_trip_reference_id: string | null
  template_id: string | null
  planned_departure_at: string | null
  planned_arrival_at: string | null
  actual_departure_at: string | null
  actual_arrival_at: string | null
  closed_at: string | null
  journey_lock_hash: string | null
  idvs_check_status: 'pending' | 'verified' | 'failed'
  idvs_checked_at: string | null
  driver: Driver | null
  horse: Vehicle | null
  trailers: Vehicle[]
  handshake_events: HandshakeEvent[]
  exceptions: TripException[]
  created_at: string
  updated_at: string
}

// Pagination envelope for GET /trips — keys confirmed: items, total, page, page_size.
export interface PaginatedList<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
