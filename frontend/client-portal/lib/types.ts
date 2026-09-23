// Mirrors backend/app/schemas/audit_pack.py — the manifest every rendering is built from.
// Kept local to this app (not @shared): nothing else in the frontend reads audit packs,
// and a portal that outsiders open should not move when the dispatcher's types do.

export type EvidenceTier = 'anchored' | 'corroborated' | 'recorded' | 'declared'
export type PositionSource = 'driver_phone' | 'vehicle_tracker' | 'trailer_tracker'
export type ObservationLevel = 'info' | 'attention'
export type LiveCheckStatus = 'verified' | 'db_mismatch' | 'hedera_mismatch' | 'no_receipt' | 'error'

export interface PositionFix {
  lat: number
  lng: number
  source: PositionSource
  recorded_at: string | null
  accuracy_metres: number | null
}

export interface AnchoredRecord {
  receipt_id: string
  subject_type: string
  subject_id: string
  receipt_type: string
  canonical_payload: string
  data_hash: string
  hedera_topic_id: string | null
  hedera_sequence_number: number | null
  hedera_tx_id: string | null
  hedera_consensus_at: string | null
  payload_matches_hash: boolean
}

export interface EvidenceFile {
  artifact_id: string
  role: string
  sha256: string
  mime_type: string
  captured_at: string
  tier: EvidenceTier
}

export interface StopRecord {
  trip_stop_id: string
  sequence: number
  precinct_id: string
  precinct_name: string
  address: string | null
  lat: number
  lng: number
  geofence_radius_metres: number
  slot_time: string | null
}

export interface VehicleRecord {
  vehicle_id: string
  role: 'horse' | 'trailer'
  registration: string
  vehicle_type: string
  make: string | null
  model: string | null
  year: number | null
  vin_number: string | null
  licence_disc_expiry: string | null
  licence_disc_valid_on_trip_date: boolean | null
  tracker_device_id: string
}

export interface DriverSubstitutionRecord {
  substitution_id: string
  original_driver_name: string
  substituting_driver_name: string
  exchange_location: string
  is_planned: boolean
  substitution_at: string
  anchor_receipt_id: string | null
  tier: EvidenceTier
}

export interface DriverRecord {
  driver_id: string
  full_name: string
  id_number: string
  id_number_masked: boolean
  license_number: string
  license_expiry: string | null
  license_valid_on_trip_date: boolean | null
  trip_idvs_status: string
  trip_idvs_checked_at: string | null
  substitutions: DriverSubstitutionRecord[]
}

export interface ParcelRecord {
  barcode: string
  status: string
  pp_scan_out_at: string | null
  pp_scan_in_at: string | null
}

export interface ConsignmentRecord {
  consignment_id: string
  parcel_perfect_reference: string
  client_name: string | null
  // Pydantic serialises Decimal as a string to keep cents exact.
  declared_value: string | null
  parcel_count_expected: number | null
  unit_count_expected: number | null
  pickup_stop_id: string | null
  delivery_stop_id: string | null
  parcels: ParcelRecord[]
}

export interface AnchoredField {
  name: string
  value: string | number | null
  matches_anchor: boolean
}

export interface LocationAssessment {
  proximity: 'within_limit' | 'separated' | 'unverified'
  separation_metres: number | null
  driver_in_precinct: boolean | null
  truck_in_precinct: boolean | null
  reasons: string[]
}

export interface PhaseRecord {
  phase_event_id: string
  sequence_number: number
  phase_type: string
  status: string
  anchor_status: string
  trip_stop_id: string | null
  precinct_name: string | null
  slot_time: string | null
  completed_at: string | null
  driver_captured_at: string | null
  driver_phone: PositionFix | null
  vehicle_tracker: PositionFix | null
  trailer_fixes: PositionFix[]
  location_assessment: LocationAssessment | null
  location_warning_acknowledged_at: string | null
  location_warning_reason: string | null
  overridden_by_dispatcher: boolean
  override_note: string | null
  seal_number: string | null
  parcel_count_origin: number | null
  parcel_count_destination: number | null
  driver_visual_count: number | null
  evidence: EvidenceFile[]
  anchored_fields: AnchoredField[]
  anchor_receipt_id: string | null
  tier: EvidenceTier
}

export interface CheckpointRecord {
  checkpoint_id: string
  checkpoint_type: string
  recorded_at: string
  driver_phone: PositionFix | null
  vehicle_tracker: PositionFix | null
  is_deviation: boolean
  note: string | null
  evidence: EvidenceFile[]
  tier: EvidenceTier
}

export interface ExceptionRecord {
  exception_id: string
  exception_type: string
  source: string
  severity: string
  description: string
  raised_at: string
  position: PositionFix | null
  phase_event_id: string | null
  checkpoint_id: string | null
  consignment_id: string | null
  review_status: string
  review_outcome: string | null
  reviewed_at: string | null
  reviewer_name: string | null
  contact_method: string | null
  review_note: string | null
  evidence: EvidenceFile[]
  tier: EvidenceTier
}

export interface RecordChange {
  subject: 'driver' | 'vehicle'
  subject_id: string
  event_type: string
  changed_fields: string[]
  changed_at: string
  anchor_receipt_id: string | null
  tier: EvidenceTier
}

export interface CoverageGap {
  start: string
  end: string
  minutes: number
}

export interface StationaryPeriod {
  start: string
  end: string
  minutes: number
  lat: number
  lng: number
}

export interface LocationCoverage {
  window_start: string | null
  window_end: string | null
  fix_counts: Partial<Record<PositionSource, number>>
  first_fix_at: string | null
  last_fix_at: string | null
  gaps: CoverageGap[]
  stationary_periods: StationaryPeriod[]
}

export interface Observation {
  code: string
  level: ObservationLevel
  text: string
  evidence_ids: string[]
}

export interface IncidentDeclarationRecord {
  declaration_id: string
  exception_id: string | null
  saps_station: string | null
  saps_cas_number: string | null
  saps_officer: string | null
  reported_to_saps_at: string | null
  tracking_company_notified_at: string | null
  insurer_notified_at: string | null
  client_notified_at: string | null
  insurer_claim_reference: string | null
  note: string | null
  declared_by_name: string | null
  declared_at: string
  tier: 'declared'
}

export interface IncidentSummary {
  exception_ids: string[]
  first_exception_type: string
  first_raised_at: string
  position: PositionFix | null
  last_known_position: PositionFix | null
  first_reviewed_at: string | null
  minutes_to_first_review: number | null
}

export interface TripSummary {
  trip_id: string
  trip_reference: string
  order_number: string
  trip_type: string
  status: string
  operator_name: string
  client_names: string[]
  pulsit_trip_reference_id: string | null
  journey_lock_hash: string | null
  created_at: string
  planned_departure_at: string | null
  planned_arrival_at: string | null
  actual_departure_at: string | null
  actual_arrival_at: string | null
  closed_at: string | null
}

export interface AuditPackManifest {
  manifest_version: number
  generated_at: string
  options: {
    scope_consignment_id: string | null
    include_location_trail: boolean
    include_full_driver_id: boolean
  }
  trip: TripSummary
  stops: StopRecord[]
  vehicles: VehicleRecord[]
  driver: DriverRecord
  consignments: ConsignmentRecord[]
  phases: PhaseRecord[]
  checkpoints: CheckpointRecord[]
  exceptions: ExceptionRecord[]
  record_changes: RecordChange[]
  location_trail: PositionFix[]
  location_coverage: LocationCoverage
  anchored_records: AnchoredRecord[]
  incident: IncidentSummary | null
  // Absent on packs issued before declarations existed.
  declarations?: IncidentDeclarationRecord[]
  observations: Observation[]
  redactions: string[]
}

export interface SealReceipt {
  canonical_payload: string
  data_hash: string
  hedera_topic_id: string | null
  hedera_sequence_number: number | null
  hedera_tx_id: string | null
  hedera_consensus_at: string | null
}

export interface PublicPackSeal {
  pack_id: string
  pack_label: string
  issued_at: string
  expires_at: string
  revoked: boolean
  anchor_status: string
  manifest_sha256: string
  pdf_sha256: string
  seal: SealReceipt | null
  hedera_network: string
  mirror_base_url: string
}

export interface PublicAuditPackView {
  seal: PublicPackSeal
  recipient_name: string
  recipient_organization: string
  purpose: string
  external_reference: string | null
  manifest: AuditPackManifest
}

export interface LiveRecordCheck {
  receipt_id: string
  subject_type: string
  subject_id: string
  status: LiveCheckStatus
}

export interface LiveVerification {
  checked_at: string
  seal_status: LiveCheckStatus
  records: LiveRecordCheck[]
  records_added_since_issue: number
}
