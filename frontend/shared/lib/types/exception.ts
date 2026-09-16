// TripException: a recorded deviation from expected trip workflow.
// Raised by driver, detected by system, or noted by dispatcher.
// Mirrors backend TripExceptionRead schema in schemas/transit.py.

// TripStatus is imported type-only: trip.ts imports TripException from here, so this
// closes a trip.ts <-> exception.ts cycle. `import type` is erased at compile time —
// must stay type-only for that to hold.
import type { TripStatus } from './trip'
import type { EvidenceArtifactWithUrl } from './evidence'
import type { VehicleId, VehicleType } from './vehicle'
import type { ActionLocationAssessment } from './action-location'

export type ExceptionId = string & { readonly __brand: 'ExceptionId' }

// All 19 backend ExceptionType values — see DRIVER_EXCEPTION_TYPES and
// SYSTEM_EXCEPTION_TYPES in lib/constants/status-meta.ts for the UI split.
export type ExceptionType =
  // System-detected (raised automatically by backend validation logic)
  | 'seal_mismatch'
  // Seals differ (theft indicator, CRITICAL) vs no departure seal recorded at all
  // (WARNING) — kept apart so filtering for tampering never surfaces overridden departures.
  | 'seal_unverified'
  | 'parcel_count_mismatch'
  | 'gps_mismatch'
  | 'driver_vehicle_separation'
  | 'route_deviation'
  | 'vehicle_substitution'
  | 'driver_substitution'
  | 'checkpoint_timeout'
  | 'waybill_count_mismatch'
  | 'sequence_violation'
  // Driver-selectable (driver raises these from the exception picker screen)
  | 'panic_button'
  | 'delivery_refused'
  | 'cargo_damage'
  | 'seal_broken_in_transit'
  | 'mechanical'
  | 'document_review'
  // Dispatcher-created (raised from the dispatcher dashboard)
  | 'dispatcher_note'
  | 'escalation'
  | 'trip_hold'
  // Receiver identity check at delivery: the ID was checked and didn't match (a theft sign),
  // or no check completed (a gap, like seal_unverified). Mirrors the backend enum.
  | 'receiver_id_mismatch'
  | 'receiver_id_unverified'

export type ExceptionSource = 'system' | 'driver' | 'dispatcher'

export type ExceptionSeverity = 'info' | 'warning' | 'critical'

// Where an exception sits in the dispatcher's review workflow. Mirrors backend
// ExceptionReviewStatus — distinguishes "nobody has looked at this" from "looked at,
// still needs a decision", which a two-state `resolved: boolean` could not.
export type ExceptionReviewStatus = 'recorded' | 'needs_review' | 'reviewed'

// What a dispatcher concluded when reviewing an exception. Mirrors backend
// ExceptionReviewOutcome. 'legacy_review' is migration-only; see DispatcherReviewOutcome
// for every real, submittable choice.
export type ExceptionReviewOutcome =
  | 'no_action_required'
  | 'handled_externally'
  | 'evidence_verified'
  | 'data_discrepancy'
  | 'referred_for_follow_up'
  | 'legacy_review'

// The choices a dispatcher may actually submit — ExceptionReviewOutcome without the
// migration-only 'legacy_review' marker. Mirrors backend DispatcherReviewOutcome.
export type DispatcherReviewOutcome = Exclude<ExceptionReviewOutcome, 'legacy_review'>

// How a dispatcher reached someone while reviewing. A null contact method records that
// the evidence settled the review without contact, rather than inventing contact history.
export type ExceptionContactMethod = 'phone' | 'whatsapp' | 'in_person'

export interface TripException {
  id: ExceptionId
  trip_id: string
  // Denormalised off the trip by the dispatcher endpoints. Optional: the driver's own
  // POST response has no trip loaded, and driver-pwa shares this type without reading it.
  trip_reference?: string | null
  exception_type: ExceptionType
  source: ExceptionSource
  severity: ExceptionSeverity
  description: string
  phase_event_id: string | null
  checkpoint_id: string | null
  supporting_artifact_id: string | null
  // Driver-phone GPS fix captured when the exception was raised (panic button today).
  // OPTIONAL so existing dispatcher code/fixtures predating these columns keep compiling.
  // POPIA: stays in Postgres, never anchored to Hedera.
  gps_lat?: number | null
  gps_lng?: number | null
  // The vehicle a breakdown was recorded against — the trip's horse or a trailer, worked
  // out server-side. Null for every other exception type.
  vehicle_id: VehicleId | null
  review_status: ExceptionReviewStatus
  // Set only once review_status reaches 'reviewed'; migrated-legacy rows instead carry
  // 'legacy_review' with no real finding on record.
  review_outcome: ExceptionReviewOutcome | null
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_note: string | null
  // Nullable when reviewed before this column existed, or reviewed without contact
  // (evidence alone settled it) — never backfilled with an invented value.
  contact_method: ExceptionContactMethod | null
  merkle_batch_id: string | null
  action_location_assessment?: ActionLocationAssessment | null
  created_at: string
  updated_at: string
}

// Row shape for the review-queue/history/detail read endpoints. Mirrors backend
// TripExceptionListItem.
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
  phase_label: string | null
  stop_label: number | null
  action_location_assessment?: ActionLocationAssessment | null
}

// GET /api/v1/exceptions/{id} — the list item plus the fields only a single-record
// view needs (GPS, review outcome, supporting evidence). Mirrors backend
// TripExceptionDetail.
export interface TripExceptionDetail extends TripExceptionListItem {
  gps_lat: number | null
  gps_lng: number | null
  review_outcome: ExceptionReviewOutcome | null
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_note: string | null
  contact_method: ExceptionContactMethod | null
  trip_closed_at: string | null
  // All three null when no vehicle was recorded. vehicle_id set with the other two null
  // means the vehicle row is gone.
  vehicle_id: VehicleId | null
  vehicle_registration: string | null
  vehicle_type: VehicleType | null
  supporting_artifact_id: string | null
  // Null when there's no photo or ownership couldn't be verified. Present with
  // signed_url: null when the artifact is real but Storage declined to sign it.
  supporting_artifact: EvidenceArtifactWithUrl | null
}
