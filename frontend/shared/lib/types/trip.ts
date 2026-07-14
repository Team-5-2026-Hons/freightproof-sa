// Trip: the primary freight movement record, progressed through five handshakes.
// Mirrors backend TripDetailResponse and TripSummaryRead schemas — see
// backend/docs/api_contract_dispatcher_driver.md §4.1 and §4.2.

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { HandshakeEvent } from './handshake'
import type { TripException } from './exception'
import type { BlockchainReceipt } from './blockchain'

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

// A sequenced waypoint on the trip's route (FP-112). Role (origin/destination) is not
// stored — it is derived per consignment. Mirrors backend TripStopRead.
export interface TripStop {
  id: string
  trip_id: string
  precinct_id: string
  sequence: number
  slot_time: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// Lightweight shape for list views (GET /trips).
// Nests full driver/horse/trailers — confirmed by API contract §4.1.
// open_exception_count is derived by the backend service layer.
export interface TripSummary {
  id: TripId
  trip_reference: string
  order_number: string
  status: TripStatus
  driver: Driver
  horse: Vehicle
  trailers: Vehicle[]
  origin_precinct_id: string
  destination_precinct_id: string
  planned_departure_at: string | null
  actual_departure_at: string | null
  planned_arrival_at: string | null
  actual_arrival_at: string | null
  open_exception_count: number
  created_at: string
  updated_at: string
}

// Full trip detail used by useTrip() — GET /trips/{id}.
// Does NOT include the parcel manifest; that is fetched separately.
export interface Trip {
  id: TripId
  trip_reference: string
  order_number: string
  status: TripStatus
  journey_lock_hash: string | null
  idvs_check_status: 'pending' | 'verified' | 'failed'
  origin_precinct_id: string
  destination_precinct_id: string
  stops: TripStop[]
  pulsit_trip_reference_id: string | null
  planned_departure_at: string | null
  actual_departure_at: string | null
  planned_arrival_at: string | null
  actual_arrival_at: string | null
  closed_at: string | null
  driver: Driver | null
  horse: Vehicle | null
  trailers: Vehicle[]
  handshakes: HandshakeEvent[]
  exceptions: TripException[]
  blockchain_receipts: BlockchainReceipt[]
  created_at: string
  updated_at: string
}

// BlockchainReceipt moved to the canonical blockchain types file.
// Re-exported here so existing imports from './trip' continue to resolve.
export type { BlockchainReceipt } from './blockchain'

// Pagination envelope for GET /trips — keys confirmed by API contract §0.2.
export interface PaginatedList<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
