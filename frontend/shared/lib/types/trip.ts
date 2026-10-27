// Trip: the primary freight movement record, progressed through a phase plan whose
// LENGTH IS DATA — 7 rows on a single-leg trip, 11 on a three-stop cross-dock.
// Mirrors backend TripDetailResponse and TripListItemResponse.

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { CoarseTripStatus, PhaseDescriptor, PhaseType } from './phase'
import type { TripException } from './exception'
import type { BlockchainReceipt } from './blockchain'
import type { PPManifestRef } from './pp-manifest'
import type { CustodyIntegrityRead, DriverAccess, SubstitutionRequestRead, CompletedSubstitutionSummary } from './driver-substitution'

export type TripId = string & { readonly __brand: 'TripId' }

export type TripType = 'loaded' | 'empty_leg'

export type { CoarseTripStatus as TripStatus } from './phase'

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

export interface TripAttention {
  critical: number
  warning: number
  info: number
  claimed: number
}

export interface TripChecklistItem {
  id: TripId
  trip_reference: string
  pp_manifest: PPManifestRef | null
  trip_type?: TripType
  status: CoarseTripStatus
  driver: { full_name: string }
  horse: { registration: string }
  origin_precinct_id: string | null
  destination_precinct_id: string | null
  needs_review_count: number
  attention?: TripAttention
  created_at: string
  current_phase: PhaseType | null
  current_stop: number | null
  phase_total: number
  phase_completed: number
}

export interface TripHistoryListItem extends TripChecklistItem {
  closed_at: string
}

export interface TripSummary extends TripChecklistItem {
  id: TripId
  trip_reference: string
  pp_manifest: PPManifestRef | null
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
  current_phase: PhaseType | null
  current_stop: number | null
  phase_total: number
  phase_completed: number
}

export interface ConsignmentRead {
  id: string
  trip_id: string | null
  parcel_perfect_reference: string
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
  unit_count_expected: number | null
  pp_manifest_number: number | null
  scanned_out_count: number
  scanned_in_count: number
  created_at: string
  updated_at: string
}

export interface Trip {
  id: TripId
  trip_reference: string
  pp_manifest: PPManifestRef | null
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
  current_phase: PhaseType | null
  current_stop: number | null
  exceptions: TripException[]
  blockchain_receipts: BlockchainReceipt[]
  warnings: string[]
  original_driver?: Driver | null
  driver_substitutions?: SubstitutionRequestRead[]
  completed_driver_substitutions?: CompletedSubstitutionSummary[]
  pending_driver_substitution?: SubstitutionRequestRead | null
  custody_sequence?: number
  custody_integrity?: CustodyIntegrityRead | null
  driver_substitutions_enabled?: boolean
  driver_access?: DriverAccess | null
  created_at: string
  updated_at: string
}

export type { BlockchainReceipt } from './blockchain'

export interface PaginatedList<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface TripConsignmentInput {
  pp_reference: string
  unit_count_expected: number
}

export interface TripCreatePayload {
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
