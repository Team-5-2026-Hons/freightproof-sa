// TripException: a recorded deviation from expected trip workflow.
// Raised by driver, detected by system, or noted by dispatcher.
// Mirrors backend TripExceptionRead schema in schemas/transit.py.

// TripStatus is imported type-only: trip.ts imports TripException from here, so this
// closes a trip.ts <-> exception.ts cycle. `import type` is erased at compile time —
// must stay type-only for that to hold.
import type { TripStatus } from './trip'
import type { ArtifactType, EvidenceArtifactWithUrl } from './evidence'
import type { VehicleId, VehicleType } from './vehicle'
import type { ActionLocationAssessment } from './action-location'
import type { BlockchainReceiptType } from './blockchain'
import type { AnchorStatus } from './phase'

export type ExceptionId = string & { readonly __brand: 'ExceptionId' }

export type ExceptionType =
  | 'seal_mismatch'
  | 'seal_unverified'
  | 'seal_compromised'
  | 'parcel_count_mismatch'
  | 'gps_mismatch'
  | 'driver_vehicle_separation'
  | 'driver_location_mismatch'
  | 'trailer_location_mismatch'
  | 'trailer_separated_in_transit'
  | 'moved_before_departure'
  | 'tracker_silent'
  | 'route_deviation'
  | 'vehicle_substitution'
  | 'driver_substitution'
  | 'checkpoint_timeout'
  | 'waybill_count_mismatch'
  | 'sequence_violation'
  | 'panic_button'
  | 'delivery_refused'
  | 'cargo_damage'
  | 'seal_broken_in_transit'
  | 'mechanical'
  | 'document_review'
  | 'dispatcher_note'
  | 'escalation'
  | 'trip_hold'
  | 'receiver_id_mismatch'
  | 'receiver_id_unverified'

export type ExceptionSource = 'system' | 'driver' | 'dispatcher'

export type ExceptionSeverity = 'info' | 'warning' | 'critical'

export type ExceptionReviewStatus = 'recorded' | 'needs_review' | 'reviewed'

export type ExceptionReviewOutcome =
  | 'no_action_required'
  | 'handled_externally'
  | 'evidence_verified'
  | 'data_discrepancy'
  | 'referred_for_follow_up'
  | 'legacy_review'
  | 'dispatcher_authored'

export type DispatcherReviewOutcome = Exclude<ExceptionReviewOutcome, 'legacy_review' | 'dispatcher_authored'>

export type ExceptionContactMethod = 'phone' | 'whatsapp' | 'in_person'

export interface ExceptionArtifactSummary {
  id: string
  position: number
  artifact_type: ArtifactType
  mime_type: string
  file_hash: string
  captured_at: string
}

export interface ExceptionPhotoWithUrl extends ExceptionArtifactSummary {
  signed_url: string | null
}

export interface EvidenceAnchorSummary {
  event_id: string
  receipt_type: BlockchainReceiptType
  anchor_status: AnchorStatus
  receipt_id: string | null
  hedera_topic_id?: string | null
  hedera_sequence_number?: number | null
  occurred_at: string
}

export interface TripException {
  id: ExceptionId
  trip_id: string
  trip_reference?: string | null
  exception_type: ExceptionType
  source: ExceptionSource
  severity: ExceptionSeverity
  description: string
  phase_event_id: string | null
  checkpoint_id: string | null
  supporting_artifact_id: string | null
  gps_lat?: number | null
  gps_lng?: number | null
  vehicle_id: VehicleId | null
  review_status: ExceptionReviewStatus
  review_outcome: ExceptionReviewOutcome | null
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_note: string | null
  contact_method: ExceptionContactMethod | null
  merkle_batch_id: string | null
  claimed_by_user_id: string | null
  claimed_at: string | null
  claimed_by_name: string | null
  reviewed_by_name: string | null
  action_location_assessment?: ActionLocationAssessment | null
  supporting_artifacts?: ExceptionArtifactSummary[]
  anchor_events?: EvidenceAnchorSummary[]
  created_at: string
  updated_at: string
}

export interface TripExceptionListItem {
  id: ExceptionId
  exception_type: ExceptionType
  source: ExceptionSource
  severity: ExceptionSeverity
  review_status: ExceptionReviewStatus
  description: string
  created_at: string
  trip_id: string
  trip_reference: string
  trip_status: TripStatus
  origin_name: string | null
  destination_name: string | null
  driver_name: string | null
  horse_registration: string | null
  trailer_registrations: string[]
  phase_label: string | null
  stop_label: number | null
  phase_event_id?: string | null
  action_location_assessment?: ActionLocationAssessment | null
  claimed_by_user_id: string | null
  claimed_at: string | null
  claimed_by_name: string | null
  reviewed_by_name: string | null
}

export interface TripExceptionDetail extends TripExceptionListItem {
  gps_lat: number | null
  gps_lng: number | null
  review_outcome: ExceptionReviewOutcome | null
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_note: string | null
  contact_method: ExceptionContactMethod | null
  trip_closed_at: string | null
  vehicle_id: VehicleId | null
  vehicle_registration: string | null
  vehicle_type: VehicleType | null
  supporting_artifact_id: string | null
  supporting_artifact: EvidenceArtifactWithUrl | null
  supporting_artifacts?: ExceptionPhotoWithUrl[]
  anchor_events?: EvidenceAnchorSummary[]
}
