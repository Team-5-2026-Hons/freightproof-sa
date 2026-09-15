// TripException: a recorded deviation from expected trip workflow.
// Raised by driver, detected by system, or noted by dispatcher.
// Mirrors backend TripExceptionRead schema in schemas/transit.py.

// TripStatus is imported type-only. trip.ts already imports TripException from this
// file, so this closes a trip.ts <-> exception.ts cycle — the same shape trip.ts
// already carries with phase.ts (see its own "TYPE-ONLY and must stay that way" note).
// `import type` is erased at compile time, so there is no runtime cycle; it must stay
// type-only for that to hold.
import type { TripStatus } from './trip'
import type { EvidenceArtifactWithUrl } from './evidence'
import type { VehicleId, VehicleType } from './vehicle'

export type ExceptionId = string & { readonly __brand: 'ExceptionId' }

// All 19 backend ExceptionType values — see DRIVER_EXCEPTION_TYPES and
// SYSTEM_EXCEPTION_TYPES in lib/constants/status-meta.ts for the UI split.
export type ExceptionType =
  // System-detected (raised automatically by backend validation logic)
  | 'seal_mismatch'
  // Two seals recorded and they differ (theft indicator, CRITICAL) vs no departure
  // seal recorded at all, so continuity is uncheckable (WARNING). Kept apart so a
  // dispatcher filtering for tampering never sees overridden departures.
  | 'seal_unverified'
  | 'parcel_count_mismatch'
  | 'gps_mismatch'
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

// Where an exception sits in the dispatcher's review workflow (FP-146 follow-on).
// Mirrors the backend ExceptionReviewStatus. Replaces the old `resolved: boolean` —
// a two-state flag could not distinguish "nobody has looked at this" from "looked at,
// still needs a decision".
export type ExceptionReviewStatus = 'recorded' | 'needs_review' | 'reviewed'

// What a dispatcher concluded when reviewing an exception. Mirrors the backend
// ExceptionReviewOutcome. 'legacy_review' is migration-only — see
// DispatcherReviewOutcome, which is every real, submittable choice.
export type ExceptionReviewOutcome =
  | 'no_action_required'
  | 'handled_externally'
  | 'evidence_verified'
  | 'data_discrepancy'
  | 'referred_for_follow_up'
  | 'legacy_review'

// The choices a dispatcher may actually submit — ExceptionReviewOutcome without the
// migration-only 'legacy_review' marker. Mirrors the backend DispatcherReviewOutcome.
export type DispatcherReviewOutcome = Exclude<ExceptionReviewOutcome, 'legacy_review'>

// How a dispatcher reached someone while reviewing — mirrors the backend
// ExceptionContactMethod. A null contact method records that the evidence settled the
// review without contact, rather than inventing contact history.
export type ExceptionContactMethod = 'phone' | 'whatsapp' | 'in_person'

export interface TripException {
  id: ExceptionId
  trip_id: string
  // Denormalised off the trip by the dispatcher endpoints, which already join it for
  // org scoping. Without it every row on the exception queue could name only a UUID.
  // Optional: the driver's own POST response is built from the ORM row alone and has
  // no trip loaded, and driver-pwa shares this type without reading the field.
  trip_reference?: string | null
  exception_type: ExceptionType
  source: ExceptionSource
  severity: ExceptionSeverity
  description: string
  // Matches the backend wire field (schemas/transit.py TripExceptionBase). Renamed
  // from the pre-phase-model `handshake_event_id` in Stage 5, which the dispatcher's
  // trip-detail timeline relies on to attach each exception to the phase it actually
  // occurred on rather than guessing at the last completed row.
  phase_event_id: string | null
  checkpoint_id: string | null
  supporting_artifact_id: string | null
  // Driver-phone GPS fix captured when the exception was raised (panic button today).
  // OPTIONAL (not just nullable) so existing dispatcher code and fixtures that predate
  // these columns keep compiling unchanged — matches Checkpoint's number|null lat/lng
  // convention in checkpoint.ts. POPIA: stays in Postgres, never anchored to Hedera.
  gps_lat?: number | null
  gps_lng?: number | null
  // The vehicle a breakdown was recorded against: the trip's horse or one of its
  // trailers, worked out by the server from the driver's "truck or trailer" answer.
  // Null for every other exception type, and for breakdowns reported before drivers were
  // asked. Required rather than optional (unlike gps_lat above): every response typed as
  // TripException (the raise POST, a trip's exceptions, the review PATCH) is backend
  // TripExceptionRead, which always carries it.
  vehicle_id: VehicleId | null
  // Task 1 (FP-146 review semantics): replaces the old `resolved: boolean` — see
  // ExceptionReviewStatus's own comment for why a two-state flag was not enough.
  review_status: ExceptionReviewStatus
  // Set only once review_status reaches 'reviewed'. Null for everything else, and for
  // every migrated-legacy row that was `resolved=true` with no real finding on record
  // (those instead carry 'legacy_review').
  review_outcome: ExceptionReviewOutcome | null
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_note: string | null
  // Nullable for every exception reviewed before this column existed, or reviewed
  // without any contact having happened (evidence alone settled it) — backfilling a
  // guess would put invented contact history onto an evidence record.
  contact_method: ExceptionContactMethod | null
  merkle_batch_id: string | null
  created_at: string
  updated_at: string
}

// Row shape for the three FP-146 follow-on read endpoints (review-queue, history,
// detail) — replaces the single unpaginated GET /api/v1/exceptions that used
// TripException above. Mirrors backend TripExceptionListItem.
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
  // The vehicle a breakdown was recorded against, with the plate and kind the backend
  // looked up for it. All three are null when no vehicle was recorded: every other
  // exception type, and every breakdown from before drivers were asked "truck or
  // trailer". vehicle_id set with the other two null means the vehicle row is gone.
  vehicle_id: VehicleId | null
  vehicle_registration: string | null
  vehicle_type: VehicleType | null
  supporting_artifact_id: string | null
  // Null when there is no photo OR ownership could not be verified. Present with
  // signed_url: null when the artifact is real but Storage declined to sign it — still
  // render the record with the image unavailable rather than hiding it.
  supporting_artifact: EvidenceArtifactWithUrl | null
}
