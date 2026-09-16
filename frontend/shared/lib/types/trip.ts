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

// Mirrors backend TripStatus. Position in the lifecycle comes from the phase ledger, so
// this is a plain description — nothing may branch on it for order. Defined in ./phase.ts
// and aliased here since `status` is the trip's own field. The resulting trip <-> phase
// cycle is TYPE-ONLY and must stay that way.
export type { CoarseTripStatus as TripStatus } from './phase'

// A sequenced waypoint on the trip's route. Role (origin/destination) is not stored — it
// is derived per consignment. Mirrors backend TripStopRead.
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

// Structural row contract shared by the active-trip list and terminal-trip history.
// Includes only what ChecklistRow renders, so the history endpoint need not disclose a
// driver's contact/licence details or a vehicle's full record to paint one row.
export interface TripChecklistItem {
  id: TripId
  trip_reference: string
  order_number: string
  status: CoarseTripStatus
  driver: { full_name: string }
  horse: { registration: string }
  origin_precinct_id: string | null
  destination_precinct_id: string | null
  needs_review_count: number
  created_at: string
  current_phase: PhaseType | null
  current_stop: number | null
  phase_total: number
  phase_completed: number
}

// Purpose-specific response from GET /trips/history. Terminal ordering and date
// filtering use closed_at; created_at stays separate for when the row shows creation time.
export interface TripHistoryListItem extends TripChecklistItem {
  closed_at: string
}

// Lightweight shape for list views (GET /trips), nesting full driver/horse/trailers.
// needs_review_count counts only NEEDS_REVIEW rows — a RECORDED row is on the trip's
// exception list but not queued for a dispatcher decision.
export interface TripSummary extends TripChecklistItem {
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
  needs_review_count: number
  created_at: string
  updated_at: string
  // Denormalised position cache, read-path only — the only way a list row can show
  // plan-driven progress without carrying the whole plan. phase_total is the plan's own
  // length; never assume 6 or 7.
  current_phase: PhaseType | null
  current_stop: number | null
  phase_total: number
  phase_completed: number
}

// One PP waybill booked onto a trip. Mirrors backend ConsignmentRead (schemas/trips.py).
export interface ConsignmentRead {
  id: string
  trip_id: string | null
  parcel_perfect_reference: string
  // Nullable: resolved from the PP accnum at sync time — an unmapped accnum leaves this
  // null (creation warning, not an error).
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
  // Live scan progress, recomputed per request — NOT the stamped parcel_count_origin /
  // parcel_count_destination on the phase rows, which are written once and are the evidence.
  scanned_out_count: number
  scanned_in_count: number
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
  // Caches of the derivation in `phases` above. The detail view must derive the active
  // phase from `phases` and must not read these — if the cache diverges, the derived view wins.
  current_phase: PhaseType | null
  current_stop: number | null
  exceptions: TripException[]
  blockchain_receipts: BlockchainReceipt[]
  // Creation-transient (e.g. PP sync degraded-mode warnings). Always [] on GET — never persisted.
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

// Trip creation payload types — mirrors backend TripConsignmentInput / TripCreateRequest
// (backend/app/schemas/trips.py).
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
