// Driver substitution (FP-83) wire contract v1 — docs/contracts/driver-substitution-v1.md.
//
// The contract document is the single source of truth. Mirrors backend
// app/schemas/driver_substitutions.py FIELD FOR FIELD: backend/tests/unit/
// test_driver_substitution_schemas.py parses this file and fails on any drift, so keep one
// property per line at two-space indent and avoid inline object types inside the interfaces
// that test checks. Contract changes must update this file, the Pydantic schemas, the
// fixtures (../mocks/driver-substitutions.ts) and both plans together.
//
// Nothing here is implemented server-side yet (C0 publishes the contract only). Original
// `Trip.driver_id` never changes; only a COMPLETED substitution changes the derived current driver.

import type { EvidenceArtifactWithUrl } from './evidence'
import type { ExceptionType, TripException } from './exception'
import type { AnchorStatus, CoarseTripStatus, PhaseType, SealCondition } from './phase'
import type { TripStop } from './trip'
import type { VehicleType } from './vehicle'
import type { IdvsStatus } from './driver'

// ── Enumerations (string unions mirror the Python enums exactly) ────────────────

export type SubstitutionState = 'pending' | 'completed' | 'cancelled'

export type SubstitutionRole = 'outgoing' | 'incoming'

// Deliberately separate from the ordinary-phase SealCondition: `not_applicable` is a
// substitution-only answer (an empty leg has no seal) and must never be a phase value.
export type SubstitutionSealCondition = 'intact' | 'damaged' | 'missing' | 'not_applicable'

export type SubstitutionAction =
  | 'confirm_outgoing'
  | 'confirm_incoming'
  | 'cancel'
  | 'replace'
  | 'complete_attested'
  | 'attest_identity'

export type SubstitutionCompletionMode = 'normal' | 'dispatcher_attested'

export type SubstitutionCompletionTrigger = 'driver_confirmation' | 'dispatcher_action'

// When several eligibility checks fail the server reports the FIRST of these, in this order.
export type SubstitutionCompletionBlocker =
  | 'incoming_driver_inactive'
  | 'licence_invalid'
  | 'driver_unavailable'
  | 'identity_not_verified'

export type SubstitutionNoticeKind = 'arranged' | 'cancelled' | 'completed'

export type DriverParticipation = 'current' | 'former'

export type LateEvidenceStatus = 'awaiting_review' | 'acknowledged'

export type LateEvidenceKind = 'phase' | 'checkpoint' | 'location' | 'exception'

export type CustodyIntegrityStatus = 'verified' | 'pending' | 'failed'

export type SubstitutionErrorCode =
  | 'TRIP_HANDED_OVER'
  | 'CUSTODY_CONTEXT_CHANGED'
  | 'CUSTODY_CONTEXT_REQUIRED'
  | 'SUBSTITUTION_VERSION_CHANGED'
  | 'SUBSTITUTION_NOT_PENDING'
  | 'DRIVER_UNAVAILABLE'
  | 'INCOMING_DRIVER_INACTIVE'
  | 'LICENCE_INVALID'
  | 'IDENTITY_ATTESTATION_FORBIDDEN'
  | 'IDENTITY_NOT_VERIFIED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'EVIDENCE_ALREADY_RECORDED'
  | 'SUBSTITUTIONS_DISABLED'

export const SUBSTITUTION_COMPLETION_BLOCKER_ORDER: readonly SubstitutionCompletionBlocker[] = [
  'incoming_driver_inactive',
  'licence_invalid',
  'driver_unavailable',
  'identity_not_verified',
]

// HTTP status per code. Domain conflicts are 409; a dispatcher lacking admin identity
// authority is 403 and the disabled flag is 503.
export const SUBSTITUTION_ERROR_STATUS: Readonly<Record<SubstitutionErrorCode, number>> = {
  TRIP_HANDED_OVER: 409,
  CUSTODY_CONTEXT_CHANGED: 409,
  CUSTODY_CONTEXT_REQUIRED: 409,
  SUBSTITUTION_VERSION_CHANGED: 409,
  SUBSTITUTION_NOT_PENDING: 409,
  DRIVER_UNAVAILABLE: 409,
  INCOMING_DRIVER_INACTIVE: 409,
  LICENCE_INVALID: 409,
  IDENTITY_ATTESTATION_FORBIDDEN: 403,
  IDENTITY_NOT_VERIFIED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  EVIDENCE_ALREADY_RECORDED: 409,
  SUBSTITUTIONS_DISABLED: 503,
}

// ── Building blocks ─────────────────────────────────────────────────────────────

// What the other party may see of a driver: no identity number, licence number or vendor data.
export interface DriverContact {
  id: string
  full_name: string
  phone_number: string
}

export interface ExchangePoint {
  // 1-255 characters
  label: string
  // -90..90
  latitude: number
  // -180..180
  longitude: number
  // 0-1000 characters
  instructions: string
}

export interface VehicleRef {
  id: string
  registration: string
  vehicle_type: VehicleType
}

// intact/damaged: seal_number + >=1 photo. missing: null number + >=1 photo. not_applicable
// (empty leg only): null number, a 1-1000 character reason, photos optional. The reason is
// null for every other condition. One check per applicable vehicle.
export interface SealCheck {
  vehicle_id: string
  condition: SubstitutionSealCondition
  // XX-#### once normalised (e.g. AB-1234).
  seal_number: string | null
  photo_artifact_ids: string[]
  not_applicable_reason: string | null
}

// The incoming driver's fleet verification status as observed. An admin attestation is a
// separate fact and never rewrites this status.
export interface IdentitySnapshot {
  driver_id: string
  status: IdvsStatus
  last_verified_at: string | null
  observed_at: string
}

// A submitted capture, without its evidence. An upload alone is never a confirmation.
export interface ConfirmationSummary {
  id: string
  role: SubstitutionRole
  driver_id: string
  captured_at: string
  received_at: string
}

// Summary plus the permitted declaration (context read and participation history).
export interface SubstitutionConfirmationDetail extends ConfirmationSummary {
  confirmed_vehicle_ids: string[]
  seal_checks: SealCheck[]
  discrepancy_note: string | null
}

// Who caused completion: exactly one actor, matching the trigger.
export interface SubstitutionCompletionRead {
  trigger: SubstitutionCompletionTrigger
  completed_by_driver_id: string | null
  completed_by_user_id: string | null
}

export interface SubstitutionRequestRead {
  id: string
  trip_id: string
  trip_reference: string
  // >= 1; advances on accepted confirmations and terminal changes.
  version: number
  state: SubstitutionState
  outgoing: DriverContact
  incoming: DriverContact
  vehicles: VehicleRef[]
  exchange: ExchangePoint
  expected_at: string
  is_planned: boolean
  reason: string
  created_at: string
  confirmations: ConfirmationSummary[]
  identity: IdentitySnapshot
  missing_confirmations: SubstitutionRole[]
  completed_substitution_id: string | null
  effective_at: string | null
  completion_mode: SubstitutionCompletionMode | null
  // Set on a PENDING request whose capture was saved but cannot yet complete (HTTP 200).
  completion_blocked_by: SubstitutionCompletionBlocker | null
  replacement_request_id: string | null
  completion: SubstitutionCompletionRead | null
  permitted_actions: SubstitutionAction[]
}

// Ongoing-collection context. Stops and findings reuse the existing driver-safe shapes.
export interface DriverSubstitutionContextRead extends Omit<SubstitutionRequestRead, 'confirmations'> {
  confirmations: SubstitutionConfirmationDetail[]
  remaining_stops: TripStop[]
  current_phase: PhaseType | null
  findings: TripException[]
  artifacts: EvidenceArtifactWithUrl[]
}

// Dispatcher-only result of verifying the full custody chain.
export interface CustodyIntegrityRead {
  status: CustodyIntegrityStatus
  amendment_count: number
  pending_anchor_count: number
  findings: string[]
}

export interface DriverAccess {
  participation: DriverParticipation
  // 0 is the original driver's period; each completed transfer increments it.
  custody_sequence: number
  can_advance: boolean
  can_submit_late_evidence: boolean
}

// References only; details need an authorised fetch.
export interface SubstitutionNoticeRead {
  id: string
  request_id: string
  trip_id: string
  kind: SubstitutionNoticeKind
  created_at: string
  read_at: string | null
}

// An appended clarification — never an edit and never a new custody assignment.
export interface SubstitutionCorrectionRead {
  id: string
  substitution_id: string
  recorded_by_user_id: string
  recorded_at: string
  reason: string
  correction_note: string
  anchor_status: AnchorStatus
  receipt_id: string | null
}

export interface CustodyPeriodRead {
  custody_sequence: number
  started_at: string | null
  ended_at: string | null
  completion_mode: SubstitutionCompletionMode | null
}

// An opaque reference to one of this driver's own immutable actions.
export interface ParticipationActionRef {
  kind: LateEvidenceKind
  id: string
  custody_sequence: number
  recorded_at: string
}

// What a known former (or current) participant may see of their own periods: no later live
// tracker trail, other drivers' identity details, cargo manifest or exception stream.
export interface DriverParticipationHistoryRead {
  trip_id: string
  trip_reference: string
  trip_status: CoarseTripStatus
  custody_periods: CustodyPeriodRead[]
  action_references: ParticipationActionRef[]
  artifacts: EvidenceArtifactWithUrl[]
  declarations: SubstitutionConfirmationDetail[]
}

// ── Late evidence ───────────────────────────────────────────────────────────────
// A discriminated union (on `kind`) over four EXISTING driver request bodies, embedded as
// `payload`. The payload types below mirror those backend schemas; they live here because
// frontend/shared cannot import from the driver app. Never an arbitrary URL or operation.

export type SealNumberSource = 'ocr_confirmed' | 'ocr_corrected' | 'typed'

// Mirrors backend _PhaseCompleteBase (schemas/phases.py).
export interface PhaseCompletePayloadBase {
  idempotency_key: string
  driver_phone_lat?: number | null
  driver_phone_lng?: number | null
  driver_captured_at?: string | null
  driver_accuracy_metres?: number | null
  location_warning_acknowledged_at?: string | null
  location_warning_reason?: string | null
}

export interface ActivationCompletePayload extends PhaseCompletePayloadBase {
  phase_type: 'activation'
  driver_phone_lat: number
  driver_phone_lng: number
}

export interface LoadingCompletePayload extends PhaseCompletePayloadBase {
  phase_type: 'loading'
  driver_visual_count?: number | null
  linehaul_photo_artifact_id?: string | null
  linehaul_pdf_artifact_id?: string | null
}

export interface DepartureCompletePayload extends PhaseCompletePayloadBase {
  phase_type: 'departure'
  waybill_photo_artifact_id?: string | null
  seal_number: string
  seal_photo_artifact_id: string
  guard_verified_seal?: boolean | null
  seal_number_confirmed?: string | null
  seal_number_source?: SealNumberSource | null
}

export interface InTransitCompletePayload extends PhaseCompletePayloadBase {
  phase_type: 'in_transit'
}

export interface ArrivalCompletePayload extends PhaseCompletePayloadBase {
  phase_type: 'arrival'
  seal_condition: SealCondition
  seal_number_at_arrival?: string | null
  seal_photo_artifact_id: string
  seal_number_source?: SealNumberSource | null
}

export interface UnloadingCompletePayload extends PhaseCompletePayloadBase {
  phase_type: 'unloading'
}

export interface ConfirmationCompletePayload extends PhaseCompletePayloadBase {
  phase_type: 'confirmation'
  pod_photo_artifact_id: string
  pod_signature_artifact_id: string
  driver_visual_count?: number | null
}

export type PhaseCompletePayload =
  | ActivationCompletePayload
  | LoadingCompletePayload
  | DepartureCompletePayload
  | InTransitCompletePayload
  | ArrivalCompletePayload
  | UnloadingCompletePayload
  | ConfirmationCompletePayload

// Mirrors backend DriverCheckpointCreateBody (schemas/transit.py).
export interface CheckpointCreatePayload {
  checkpoint_type: string
  driver_phone_lat?: number | null
  driver_phone_lng?: number | null
  horse_gps_lat?: number | null
  horse_gps_lng?: number | null
  driver_captured_at?: string | null
  driver_accuracy_metres?: number | null
  client_report_id?: string | null
  phase_event_id?: string | null
  selfie_artifact_id?: string | null
  cargo_photo_artifact_id?: string | null
  note?: string | null
  is_deviation?: boolean
}

// Mirrors backend LocationPingCreate / LocationPingBatch (schemas/locations.py).
export interface LocationPingPayload {
  lat: number
  lng: number
  accuracy_m?: number | null
  context: string
  recorded_at: string
}

export interface LocationBatchPayload {
  pings: LocationPingPayload[]
}

// Mirrors backend DriverExceptionCreateBody (schemas/transit.py).
export interface ExceptionCreatePayload {
  exception_type: ExceptionType
  description: string
  supporting_artifact_id?: string | null
  supporting_artifact_ids?: string[] | null
  phase_event_id?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
  driver_accuracy_metres?: number | null
  driver_captured_at?: string | null
  client_report_id?: string | null
  vehicle_type?: VehicleType | null
  trailer_id?: string | null
}

export interface LatePhaseEvidence {
  kind: 'phase'
  payload: PhaseCompletePayload
}

export interface LateCheckpointEvidence {
  kind: 'checkpoint'
  payload: CheckpointCreatePayload
}

export interface LateLocationEvidence {
  kind: 'location'
  payload: LocationBatchPayload
}

export interface LateExceptionEvidence {
  kind: 'exception'
  payload: ExceptionCreatePayload
}

export type LateEvidencePayload =
  | LatePhaseEvidence
  | LateCheckpointEvidence
  | LateLocationEvidence
  | LateExceptionEvidence

export interface LateEvidenceRead {
  id: string
  trip_id: string
  driver_id: string
  custody_sequence: number
  captured_at: string
  received_at: string
  status: LateEvidenceStatus
  artifact_ids: string[]
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  review_note: string | null
}

// Dispatcher view: the retained typed evidence, its commitment and scoped artifact URLs.
export interface LateEvidenceDetailRead extends LateEvidenceRead {
  evidence: LateEvidencePayload
  payload_sha256: string
  artifacts: EvidenceArtifactWithUrl[]
}

// ── Request bodies ──────────────────────────────────────────────────────────────
// Actor IDs always come from the token, never these bodies; the server rejects extra fields.

export interface ArrangeSubstitutionRequest {
  client_request_id: string
  incoming_driver_id: string
  exchange: ExchangePoint
  expected_at: string
  is_planned: boolean
  // 1-1000 characters
  reason: string
}

export interface CancelSubstitutionRequest {
  client_request_id: string
  expected_version: number
  reason: string
}

// Cancels the old request and creates a fresh one atomically (no inherited confirmations).
export interface ReplaceSubstitutionRequest {
  client_request_id: string
  expected_version: number
  replacement_reason: string
  incoming_driver_id: string
  exchange: ExchangePoint
  expected_at: string
  is_planned: boolean
  reason: string
}

// latitude, longitude and accuracy_metres are null together when capture was unavailable.
export interface ConfirmSubstitutionRequest {
  client_request_id: string
  expected_version: number
  captured_at: string
  latitude: number | null
  longitude: number | null
  accuracy_metres: number | null
  confirmed_vehicle_ids: string[]
  seal_checks: SealCheck[]
  discrepancy_note: string | null
}

// Null reasons mean no attestation was requested; a supplied reason must be real text.
export interface CompleteSubstitutionRequest {
  client_request_id: string
  expected_version: number
  missing_confirmation_reason: string | null
  identity_unavailable_reason: string | null
  declared_exchange_at: string | null
}

export interface CorrectSubstitutionRequest {
  client_request_id: string
  reason: string
  correction_note: string
}

export interface LateEvidenceRequest {
  client_request_id: string
  custody_sequence: number
  captured_at: string
  original_idempotency_key: string | null
  evidence: LateEvidencePayload
  artifact_ids: string[]
}

export interface AcknowledgeLateEvidenceRequest {
  client_request_id: string
  note: string
}

// ── Errors ──────────────────────────────────────────────────────────────────────

// FastAPI's `detail` object for a domain conflict. Existing clients must also parse the
// legacy string `detail`.
export interface SubstitutionErrorDetail {
  code: SubstitutionErrorCode
  message: string
  request_id?: string | null
  current_version?: number | null
  evidence_id?: string | null
}

export interface SubstitutionErrorResponse {
  detail: SubstitutionErrorDetail
}
