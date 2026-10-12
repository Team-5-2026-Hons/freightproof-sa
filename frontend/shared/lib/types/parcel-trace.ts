// FP-149 read DTOs. Journey history is projected from phase_events, never stored separately.
import type { AnchorStatus, CoarseTripStatus, PhaseStatus, PhaseType } from './phase'
import type { Parcel } from './manifest'

export interface ParcelMatch {
  waybill_reference: string
  journey_count: number
}

export interface ParcelLookupResponse {
  barcode: string
  items: ParcelMatch[]
  next_after: string | null
}

export interface ParcelScanObservation {
  parcel_id: string
  status: Parcel['status']
  scan_out_at: string | null
  scan_in_at: string | null
  source: 'parcel_record_source_unknown'
}

export interface ParcelTracePhase {
  id: string
  sequence_number: number
  phase_type: PhaseType
  status: PhaseStatus
  completed_at: string | null
  driver_captured_at: string | null
  precinct_id: string | null
  precinct_name: string | null
  relevance: 'consignment' | 'trip_context' | 'unknown'
  anchor_status: AnchorStatus
  seal_number: string | null
  seal_condition: string | null
  location_verdict: 'confirmed' | 'mismatch' | 'unwitnessed' | 'not_recorded'
  override_note: string | null
}

export interface ParcelProgress {
  position: 'before_pickup' | 'within_journey' | 'after_delivery' | 'cancelled' | 'unknown'
  phase_event_id: string | null
  phase_type: PhaseType | null
  phase_status: PhaseStatus | null
  has_overrides: boolean
}

export interface ParcelRecordedLocation {
  phase_event_id: string
  precinct_name: string | null
  source: 'horse_tracker' | 'driver_phone'
  captured_at: string | null
  phase_completed_at: string | null
  precinct_confirmed: boolean | null
}

export interface ParcelSealWindow {
  departure_phase_id: string
  inspection_phase_id: string | null
  phase_ids: string[]
  origin_name: string | null
  destination_name: string | null
  departure_seal: string | null
  arrival_seal: string | null
  status: 'matched' | 'mismatch' | 'pending' | 'unverified'
}

export interface ParcelTraceException {
  id: string
  phase_event_id: string | null
  exception_type: string
  severity: string
  description: string
  recorded_at: string
  scope: 'consignment' | 'trip_context'
  review_status: string
}

export interface ParcelJourney {
  trip_id: string
  trip_reference: string
  trip_status: CoarseTripStatus
  created_at: string
  vehicle_registration: string | null
  membership_source: 'current_assignment' | 'creation_manifest'
  origin_name: string | null
  destination_name: string | null
  progress: ParcelProgress
  last_recorded_location: ParcelRecordedLocation | null
  scans: ParcelScanObservation[]
  phases: ParcelTracePhase[]
  seal_windows: ParcelSealWindow[]
  exceptions: ParcelTraceException[]
  gaps: string[]
}

export interface ParcelTraceResponse {
  barcode: string
  waybill_reference: string
  journeys: ParcelJourney[]
  next_cursor: string | null
  coverage_note: string
}
