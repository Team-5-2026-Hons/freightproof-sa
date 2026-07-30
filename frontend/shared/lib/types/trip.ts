// Trip: the primary freight movement record, progressed through a phase plan whose
// LENGTH IS DATA — 7 rows on a single-leg trip, 11 on a three-stop cross-dock.
// Mirrors backend TripDetailResponse and TripListItemResponse.

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { CoarseTripStatus, PhaseDescriptor, PhaseType } from './phase'
import type { TripException } from './exception'
import type { BlockchainReceipt } from './blockchain'

export type TripId = string & { readonly __brand: 'TripId' }

// Mirrors backend TripType enum (app/db/models/enums.py) — a trip either carries
// PP consignments ("loaded") or is a deadhead/repositioning move ("empty_leg").
export type TripType = 'loaded' | 'empty_leg'

// Mirrors backend TripStatus (coarse since Stage 2 — parent plan §2.3). The old
// ten-value union doubled as the sequencer; position now comes from the phase
// ledger, so this is a plain description and nothing may branch on it for order.
// Defined in ./phase.ts because "coarse status" is phase-model vocabulary; aliased
// here because `status` is the trip's own field and ten files import this name.
// The resulting trip <-> phase cycle is TYPE-ONLY and must stay that way.
export type { CoarseTripStatus as TripStatus } from './phase'

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
  status: CoarseTripStatus
  trip_type: TripType
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
  // Denormalised position cache (parent D6), read-path only. The list view carries
  // no plan, so these four are the only way a row can show plan-driven progress.
  // phase_total is the plan's own length — never assume 6, never assume 7.
  current_phase: PhaseType | null
  current_stop: number | null
  phase_total: number
  phase_completed: number
}

// One PP waybill booked onto a trip. Mirrors backend ConsignmentRead
// (backend/app/schemas/trips.py) — a minimal frontend interface since no
// consignment type existed here before this trip's response started including it.
export interface ConsignmentRead {
  id: string
  trip_id: string | null
  parcel_perfect_reference: string
  // Nullable: resolved from the PP accnum at sync time — an unmapped accnum
  // leaves this null on the consignment (creation warning, not an error).
  client_organization_id: string | null
  origin_precinct_id: string | null
  destination_precinct_id: string | null
  declared_value: number | null
  parcel_count_expected: number | null
  slot_time_origin: string | null
  slot_time_destination: string | null
  pp_raw_json: unknown | null
  pickup_stop_id: string | null
  delivery_stop_id: string | null
  load_priority: number | null
  // Consolidated-unit (pallet) grain — dispatcher-entered, distinct from parcel grain.
  unit_count_expected: number | null
  pp_manifest_number: number | null
  created_at: string
  updated_at: string
}

// Full trip detail used by useTrip() — GET /trips/{id}.
// Does NOT include the parcel manifest; that is fetched separately.
export interface Trip {
  id: TripId
  trip_reference: string
  order_number: string
  status: CoarseTripStatus
  trip_type: TripType
  journey_lock_hash: string | null
  idvs_check_status: 'pending' | 'verified' | 'failed'
  origin_precinct_id: string
  destination_precinct_id: string
  stops: TripStop[]
  consignments: ConsignmentRead[]
  pulsit_trip_reference_id: string | null
  planned_departure_at: string | null
  actual_departure_at: string | null
  planned_arrival_at: string | null
  actual_arrival_at: string | null
  closed_at: string | null
  driver: Driver | null
  horse: Vehicle | null
  trailers: Vehicle[]
  phases: PhaseDescriptor[]
  // Caches of the derivation in `phases` above. The trip-DETAIL view must derive
  // the active phase from `phases` (see dispatcher lib/phase/derive.ts) and must
  // not read these — if the cache ever diverges, the derived view tells the truth.
  current_phase: PhaseType | null
  current_stop: number | null
  exceptions: TripException[]
  blockchain_receipts: BlockchainReceipt[]
  // Creation-transient: populated by POST /trips (e.g. PP sync degraded-mode
  // warnings). Always [] on GET — never persisted.
  warnings: string[]
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

// Trip creation payload types — mirrors backend TripConsignmentInput /
// TripCreateRequest (backend/app/schemas/trips.py). Exported for the
// dispatcher trip-creation wizard (Task 10).
export interface TripConsignmentInput {
  pp_reference: string
  unit_count_expected: number
}

export interface TripCreatePayload {
  order_number: string
  trip_type: TripType
  driver_id: string
  horse_id: string
  trailer_ids: string[]
  origin_precinct_id: string
  destination_precinct_id: string
  consignments: TripConsignmentInput[]
  planned_departure_at: string | null
  planned_arrival_at: string | null
}
