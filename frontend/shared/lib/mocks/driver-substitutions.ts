// Driver substitution (FP-83) fixture pack — docs/contracts/driver-substitution-v1.md
// "Tim's fixture pack and contract gate".
//
// Typed against ../types/driver-substitution.ts so a contract change breaks the build here
// first. Identities are fictional ("Fixture Driver …", reserved +27000000xxx numbers) and every
// id is a generated local test id (f8300000-… prefix), never copied from real or other mock
// data. The pack is the integration boundary: Tim builds T1–T3 against it before the
// endpoints exist, and C6 compares the live OpenAPI schema with it.
//
// Two kinds of "blocked" are kept apart on purpose. A driver confirmation whose capture was
// SAVED but cannot yet complete is a 200 SUCCESS body carrying `completion_blocked_by`
// (blockedConfirmationFixtures); a refused dispatcher action or a conflict is an ERROR
// response (substitutionErrorFixtures). They share no fixture.
//
// The demo drivers need a non-null `license_expiry`: the substitution licence rule rejects null.

import type { Driver, DriverId } from '../types/driver'
import type {
  AcknowledgeLateEvidenceRequest,
  ArrangeSubstitutionRequest,
  CancelSubstitutionRequest,
  CompleteSubstitutionRequest,
  ConfirmSubstitutionRequest,
  ConfirmationSummary,
  CorrectSubstitutionRequest,
  CustodyIntegrityRead,
  DriverAccess,
  DriverContact,
  DriverParticipationHistoryRead,
  DriverSubstitutionContextRead,
  ExchangePoint,
  IdentitySnapshot,
  LateEvidenceDetailRead,
  LateEvidenceKind,
  LateEvidenceRead,
  LateEvidenceRequest,
  ReplaceSubstitutionRequest,
  SealCheck,
  SubstitutionCompletionBlocker,
  SubstitutionConfirmationDetail,
  SubstitutionCorrectionRead,
  SubstitutionErrorCode,
  SubstitutionErrorResponse,
  SubstitutionNoticeRead,
  SubstitutionRequestRead, SubstitutionRole,
  VehicleRef,
} from '../types/driver-substitution'
import { SUBSTITUTION_ERROR_STATUS } from '../types/driver-substitution'
import type { ArtifactId, EvidenceArtifactWithUrl } from '../types/evidence'
import type { ExceptionId, TripException } from '../types/exception'
import type { Trip, TripStop } from '../types/trip'
import type { VehicleId } from '../types/vehicle'

const fx = (n: number): string => `f8300000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ORG_ID = fx(1)
const TRIP_ID = fx(2)
const TRIP_REFERENCE = 'TRP-FIX-0001'
const OUTGOING_ID = fx(10)
const INCOMING_ID = fx(11)
const THIRD_ID = fx(12)
const HORSE_ID = fx(20)
const TRAILER_ID = fx(21)
const DISPATCHER_ID = fx(30)
const ADMIN_ID = fx(31)

const T = {
  arranged: '2026-10-20T07:00:00+02:00',
  expected: '2026-10-20T10:30:00+02:00',
  outgoingCaptured: '2026-10-20T10:28:00+02:00',
  outgoingReceived: '2026-10-20T10:28:03+02:00',
  incomingCaptured: '2026-10-20T10:31:00+02:00',
  incomingReceived: '2026-10-20T10:31:05+02:00',
  completed: '2026-10-20T10:31:06+02:00',
  verified: '2026-10-01T09:00:00+02:00',
  observed: '2026-10-20T07:00:00+02:00',
} as const

const outgoing: DriverContact = { id: OUTGOING_ID, full_name: 'Fixture Driver Outgoing', phone_number: '+27000000010' }
const incoming: DriverContact = { id: INCOMING_ID, full_name: 'Fixture Driver Incoming', phone_number: '+27000000011' }
const third: DriverContact = { id: THIRD_ID, full_name: 'Fixture Driver Third', phone_number: '+27000000012' }

const horse: VehicleRef = { id: HORSE_ID, registration: 'FIX 001 GP', vehicle_type: 'horse' }
const trailer: VehicleRef = { id: TRAILER_ID, registration: 'FIX 002 GP', vehicle_type: 'trailer' }

const exchange: ExchangePoint = {
  label: 'Fixture Fuel Stop, Harrismith',
  latitude: -28.2733,
  longitude: 29.1274,
  instructions: 'Park beside the diesel island and wait for the incoming driver.',
}

const identity = (driverId: string, status: IdentitySnapshot['status']): IdentitySnapshot => ({
  driver_id: driverId,
  status,
  last_verified_at: status === 'verified' ? T.verified : null,
  observed_at: T.observed,
})

const fleetDriver = (id: string, name: string, phone: string, over: Partial<Driver> = {}): Driver => ({
  id: id as unknown as DriverId,
  organization_id: ORG_ID,
  full_name: name,
  id_number: '0000000000000',
  phone_number: phone,
  license_number: `FIXTURE-LIC-${id.slice(-3)}`,
  license_expiry: '2027-06-30',
  is_active: true,
  idvs_status: 'verified',
  idvs_last_verified_at: T.verified,
  created_at: '2026-01-01T08:00:00+02:00',
  updated_at: T.verified,
  ...over,
})
const outgoingFleetRecord = fleetDriver(OUTGOING_ID, outgoing.full_name, outgoing.phone_number)
const incomingFleetRecord = fleetDriver(INCOMING_ID, incoming.full_name, incoming.phone_number)

const PHOTO_HORSE = fx(400)
const PHOTO_TRAILER = fx(401)
const PHOTO_ABSENT = fx(402)

const intactSeal = (vehicleId: string, photo: string, number: string): SealCheck => ({
  vehicle_id: vehicleId,
  condition: 'intact',
  seal_number: number,
  photo_artifact_ids: [photo],
  not_applicable_reason: null,
})
const missingSeal: SealCheck = {
  vehicle_id: TRAILER_ID,
  condition: 'missing',
  seal_number: null,
  photo_artifact_ids: [PHOTO_ABSENT],
  not_applicable_reason: null,
}
const notApplicableSeal: SealCheck = {
  vehicle_id: TRAILER_ID,
  condition: 'not_applicable',
  seal_number: null,
  photo_artifact_ids: [],
  not_applicable_reason: 'Empty repositioning leg: the trailer carries no sealed load.',
}

const confirmBody = (over: Partial<ConfirmSubstitutionRequest> = {}): ConfirmSubstitutionRequest => ({
  client_request_id: fx(500),
  expected_version: 1,
  captured_at: T.outgoingCaptured,
  latitude: -28.2734,
  longitude: 29.1275,
  accuracy_metres: 6.5,
  confirmed_vehicle_ids: [HORSE_ID, TRAILER_ID],
  seal_checks: [intactSeal(HORSE_ID, PHOTO_HORSE, 'AB-1234'), intactSeal(TRAILER_ID, PHOTO_TRAILER, 'CD-5678')],
  discrepancy_note: null,
  ...over,
})

const confirmation = (id: string, role: 'outgoing' | 'incoming'): ConfirmationSummary =>
  role === 'outgoing'
    ? { id, role, driver_id: OUTGOING_ID, captured_at: T.outgoingCaptured, received_at: T.outgoingReceived }
    : { id, role, driver_id: INCOMING_ID, captured_at: T.incomingCaptured, received_at: T.incomingReceived }

const outgoingConfirmation = confirmation(fx(200), 'outgoing')
const incomingConfirmation = confirmation(fx(201), 'incoming')

const request = (over: Partial<SubstitutionRequestRead> = {}): SubstitutionRequestRead => ({
  id: fx(100),
  trip_id: TRIP_ID,
  trip_reference: TRIP_REFERENCE,
  version: 1,
  state: 'pending',
  outgoing,
  incoming,
  vehicles: [horse, trailer],
  exchange,
  expected_at: T.expected,
  is_planned: true,
  reason: 'Outgoing driver reaches the legal driving-hours limit at Harrismith.',
  created_at: T.arranged,
  confirmations: [],
  identity: identity(INCOMING_ID, 'verified'),
  missing_confirmations: ['outgoing', 'incoming'],
  completed_substitution_id: null,
  effective_at: null,
  completion_mode: null,
  completion_blocked_by: null,
  replacement_request_id: null,
  completion: null,
  permitted_actions: [],
  ...over,
})

const outgoingPending = request({ permitted_actions: ['confirm_outgoing'] })
const incomingPending = request({ permitted_actions: ['confirm_incoming'] })

const oneConfirmation = request({
  version: 2,
  confirmations: [outgoingConfirmation],
  missing_confirmations: ['incoming'],
  permitted_actions: ['confirm_incoming'],
})

const normalCompleted = request({
  version: 3,
  state: 'completed',
  confirmations: [outgoingConfirmation, incomingConfirmation],
  missing_confirmations: [],
  completed_substitution_id: fx(300),
  effective_at: T.completed,
  completion_mode: 'normal',
  completion: { trigger: 'driver_confirmation', completed_by_driver_id: INCOMING_ID, completed_by_user_id: null },
})

const dispatcherAttestedCompleted = request({
  version: 3,
  state: 'completed',
  confirmations: [incomingConfirmation],
  missing_confirmations: ['outgoing'],
  completed_substitution_id: fx(301),
  effective_at: T.completed,
  completion_mode: 'dispatcher_attested',
  completion: { trigger: 'dispatcher_action', completed_by_driver_id: null, completed_by_user_id: DISPATCHER_ID },
})

const identityUnavailableCompleted = request({
  version: 3,
  state: 'completed',
  identity: identity(INCOMING_ID, 'pending'),
  confirmations: [outgoingConfirmation, incomingConfirmation],
  missing_confirmations: [],
  completed_substitution_id: fx(302),
  effective_at: T.completed,
  completion_mode: 'dispatcher_attested',
  completion: { trigger: 'dispatcher_action', completed_by_driver_id: null, completed_by_user_id: ADMIN_ID },
})

const cancelled = request({ id: fx(102), version: 2, state: 'cancelled' })

const replacement = request({
  id: fx(101),
  incoming: third,
  identity: identity(THIRD_ID, 'verified'),
  reason: 'Incoming driver fell ill; replaced by the third driver.',
})
const replacedOld = request({ version: 2, state: 'cancelled', replacement_request_id: replacement.id })

const identityFailed = request({
  id: fx(103),
  identity: identity(INCOMING_ID, 'failed'),
  permitted_actions: ['cancel', 'replace'],
})

const blockedBody = (blocker: SubstitutionCompletionBlocker): SubstitutionRequestRead =>
  request({
    id: fx(110 + ['incoming_driver_inactive', 'licence_invalid', 'driver_unavailable', 'identity_not_verified'].indexOf(blocker)),
    version: 3,
    identity: identity(INCOMING_ID, blocker === 'identity_not_verified' ? 'pending' : 'verified'),
    confirmations: [outgoingConfirmation, incomingConfirmation],
    missing_confirmations: [],
    completion_blocked_by: blocker,
    permitted_actions: ['cancel', 'replace', 'complete_attested'],
  })

export const blockedConfirmationFixtures: Record<
  SubstitutionCompletionBlocker,
  { http_status: 200; body: SubstitutionRequestRead }
> = {
  incoming_driver_inactive: { http_status: 200, body: blockedBody('incoming_driver_inactive') },
  licence_invalid: { http_status: 200, body: blockedBody('licence_invalid') },
  driver_unavailable: { http_status: 200, body: blockedBody('driver_unavailable') },
  identity_not_verified: { http_status: 200, body: blockedBody('identity_not_verified') },
}

const detail = (base: ConfirmationSummary, seals: SealCheck[], note: string | null): SubstitutionConfirmationDetail => ({
  ...base,
  confirmed_vehicle_ids: [HORSE_ID, TRAILER_ID],
  seal_checks: seals,
  discrepancy_note: note,
})

const remainingStop: TripStop = {
  id: fx(600),
  trip_id: TRIP_ID,
  precinct_id: fx(601),
  sequence: 1,
  slot_time: '2026-10-20T18:00:00+02:00',
  notes: null,
  created_at: T.arranged,
  updated_at: T.arranged,
}

const finding: TripException = {
  id: fx(700) as unknown as ExceptionId,
  trip_id: TRIP_ID,
  exception_type: 'route_deviation',
  source: 'system',
  severity: 'warning',
  description: 'The vehicle left the planned route for 2.1 km before rejoining.',
  phase_event_id: null,
  checkpoint_id: null,
  supporting_artifact_id: null,
  vehicle_id: HORSE_ID as unknown as VehicleId,
  review_status: 'needs_review',
  review_outcome: null,
  reviewed_by_user_id: null,
  reviewed_at: null,
  review_note: null,
  contact_method: null,
  merkle_batch_id: null,
  claimed_by_user_id: null,
  claimed_at: null,
  claimed_by_name: null,
  reviewed_by_name: null,
  created_at: '2026-10-20T09:40:00+02:00',
  updated_at: '2026-10-20T09:40:00+02:00',
}

const sealPhoto: EvidenceArtifactWithUrl = {
  id: PHOTO_HORSE as unknown as ArtifactId,
  trip_id: TRIP_ID,
  artifact_type: 'photo',
  s3_key: 'fixtures/substitution/horse-seal.jpg',
  s3_bucket: 'fixture-evidence',
  file_hash: 'a'.repeat(64),
  mime_type: 'image/jpeg',
  captured_at: T.outgoingCaptured,
  captured_by_driver_id: OUTGOING_ID,
  captured_by_user_id: null,
  captured_lat: -28.2734,
  captured_lng: 29.1275,
  created_at: T.outgoingReceived,
  phase_event_id: null,
  evidence_role: null,
  signed_url: 'https://fixtures.invalid/signed/horse-seal.jpg',
}

const contextWithFindings: DriverSubstitutionContextRead = {
  ...oneConfirmation,
  confirmations: [detail(outgoingConfirmation, [intactSeal(HORSE_ID, PHOTO_HORSE, 'AB-1234'), missingSeal], 'Trailer seal absent on arrival at the exchange.')],
  remaining_stops: [remainingStop],
  current_phase: 'in_transit',
  findings: [finding],
  artifacts: [sealPhoto],
}

const formerAccess: DriverAccess = { participation: 'former', custody_sequence: 0, can_advance: false, can_submit_late_evidence: true }
const currentAccessAfterTransfer: DriverAccess = { participation: 'current', custody_sequence: 1, can_advance: true, can_submit_late_evidence: true }
const originalDriverAccess: DriverAccess = { participation: 'current', custody_sequence: 0, can_advance: true, can_submit_late_evidence: false }

const formerHistory: DriverParticipationHistoryRead = {
  trip_id: TRIP_ID,
  trip_reference: TRIP_REFERENCE,
  trip_status: 'active',
  custody_periods: [{ custody_sequence: 0, started_at: '2026-10-20T06:00:00+02:00', ended_at: T.completed, completion_mode: null }],
  action_references: [{ kind: 'phase', id: fx(800), custody_sequence: 0, recorded_at: '2026-10-20T06:30:00+02:00' }],
  artifacts: [sealPhoto],
  declarations: [detail(outgoingConfirmation, [intactSeal(HORSE_ID, PHOTO_HORSE, 'AB-1234'), notApplicableSeal], null)],
}

const lateAwaiting: LateEvidenceRead = {
  id: fx(900),
  trip_id: TRIP_ID,
  driver_id: OUTGOING_ID,
  custody_sequence: 0,
  captured_at: '2026-10-20T10:20:00+02:00',
  received_at: '2026-10-20T11:05:00+02:00',
  status: 'awaiting_review',
  artifact_ids: [PHOTO_HORSE],
  reviewed_by_user_id: null,
  reviewed_at: null,
  review_note: null,
}
const lateAcknowledged: LateEvidenceRead = {
  ...lateAwaiting,
  id: fx(901),
  status: 'acknowledged',
  reviewed_by_user_id: DISPATCHER_ID,
  reviewed_at: '2026-10-20T11:30:00+02:00',
  review_note: 'Reviewed the photo; consistent with the recorded handover.',
}
const lateDetail: LateEvidenceDetailRead = {
  ...lateAwaiting,
  evidence: {
    kind: 'checkpoint',
    payload: { checkpoint_type: 'routine', driver_captured_at: lateAwaiting.captured_at, note: 'Fuel stop before the handover.', is_deviation: false },
  },
  payload_sha256: 'b'.repeat(64),
  artifacts: [sealPhoto],
}

const lateRequest = (kind: LateEvidenceKind, evidence: LateEvidenceRequest['evidence']): LateEvidenceRequest => ({
  client_request_id: fx(910 + ['phase', 'checkpoint', 'location', 'exception'].indexOf(kind)),
  custody_sequence: 0,
  captured_at: lateAwaiting.captured_at,
  original_idempotency_key: kind === 'phase' ? 'queue-entry-0001' : null,
  evidence,
  artifact_ids: [],
})
const lateRequests: Record<LateEvidenceKind, LateEvidenceRequest> = {
  phase: lateRequest('phase', { kind: 'phase', payload: { phase_type: 'in_transit', idempotency_key: 'queue-entry-0001' } }),
  checkpoint: lateRequest('checkpoint', { kind: 'checkpoint', payload: { checkpoint_type: 'routine' } }),
  location: lateRequest('location', {
    kind: 'location',
    payload: { pings: [{ lat: -28.27, lng: 29.12, accuracy_m: 9, context: 'transit', recorded_at: lateAwaiting.captured_at }] },
  }),
  exception: lateRequest('exception', {
    kind: 'exception',
    payload: { exception_type: 'mechanical', description: 'Tyre pressure warning before the handover.', vehicle_type: 'horse' },
  }),
}

export const noticeFixtures: Record<'arrangedUnread' | 'cancelledUnread' | 'completedRead', SubstitutionNoticeRead> = {
  arrangedUnread: { id: fx(950), request_id: outgoingPending.id, trip_id: TRIP_ID, kind: 'arranged', created_at: T.arranged, read_at: null },
  cancelledUnread: { id: fx(951), request_id: cancelled.id, trip_id: TRIP_ID, kind: 'cancelled', created_at: T.arranged, read_at: null },
  completedRead: { id: fx(952), request_id: normalCompleted.id, trip_id: TRIP_ID, kind: 'completed', created_at: T.completed, read_at: '2026-10-20T10:32:00+02:00' },
}

const clarification: Record<'pending' | 'anchored', SubstitutionCorrectionRead> = {
  pending: {
    id: fx(960),
    substitution_id: normalCompleted.completed_substitution_id ?? fx(300),
    recorded_by_user_id: DISPATCHER_ID,
    recorded_at: '2026-10-20T12:00:00+02:00',
    reason: 'Exchange label misspelt',
    correction_note: 'The exchange took place at the Harrismith Engen, not the Shell forecourt named in the label.',
    anchor_status: 'pending',
    receipt_id: null,
  },
  anchored: {
    id: fx(961),
    substitution_id: normalCompleted.completed_substitution_id ?? fx(300),
    recorded_by_user_id: DISPATCHER_ID,
    recorded_at: '2026-10-20T12:00:00+02:00',
    reason: 'Exchange label misspelt',
    correction_note: 'The exchange took place at the Harrismith Engen, not the Shell forecourt named in the label.',
    anchor_status: 'anchored',
    receipt_id: fx(962),
  },
}

const custodyIntegrityPending: CustodyIntegrityRead = {
  status: 'pending',
  amendment_count: 1,
  pending_anchor_count: 1,
  findings: ['Amendment 1 is awaiting its Hedera receipt.'],
}
const custodyIntegrityFailed: CustodyIntegrityRead = {
  status: 'failed',
  amendment_count: 2,
  pending_anchor_count: 0,
  findings: ['Amendment 2 does not reference the hash of amendment 1.'],
}

export type TripCustodyFields = Required<
  Pick<
    Trip,
    | 'driver'
    | 'original_driver'
    | 'driver_substitutions'
    | 'pending_driver_substitution'
    | 'custody_sequence'
    | 'custody_integrity'
    | 'driver_substitutions_enabled'
    | 'driver_access'
  >
>

const noSubstitution: TripCustodyFields = {
  driver: outgoingFleetRecord,
  original_driver: outgoingFleetRecord,
  driver_substitutions: [],
  pending_driver_substitution: null,
  custody_sequence: 0,
  custody_integrity: null,
  driver_substitutions_enabled: true,
  driver_access: null,
}

const pendingSecondHandover = request({
  id: fx(104),
  outgoing: incoming,
  incoming: third,
  identity: identity(THIRD_ID, 'verified'),
  permitted_actions: ['cancel', 'replace'],
})
const flagOffDetail: TripCustodyFields = {
  driver: incomingFleetRecord,
  original_driver: outgoingFleetRecord,
  driver_substitutions: [normalCompleted],
  pending_driver_substitution: pendingSecondHandover,
  custody_sequence: 1,
  custody_integrity: { status: 'verified', amendment_count: 1, pending_anchor_count: 0, findings: [] },
  driver_substitutions_enabled: false,
  driver_access: null,
}

type ErrorFixture = { http_status: number; body: SubstitutionErrorResponse }

const errorFixture = (
  code: SubstitutionErrorCode,
  message: string,
  extra: Partial<SubstitutionErrorResponse['detail']> = {},
): ErrorFixture => ({
  http_status: SUBSTITUTION_ERROR_STATUS[code],
  body: { detail: { code, message, ...extra } },
})

export const substitutionErrorFixtures: Record<SubstitutionErrorCode, ErrorFixture> = {
  TRIP_HANDED_OVER: errorFixture('TRIP_HANDED_OVER', 'This trip has been handed over; your live actions are closed.'),
  CUSTODY_CONTEXT_CHANGED: errorFixture('CUSTODY_CONTEXT_CHANGED', 'This capture belongs to an earlier custody period.'),
  CUSTODY_CONTEXT_REQUIRED: errorFixture('CUSTODY_CONTEXT_REQUIRED', 'A custody sequence is required after a handover.'),
  SUBSTITUTION_VERSION_CHANGED: errorFixture('SUBSTITUTION_VERSION_CHANGED', 'The arrangement changed; refetch before acting.', {
    request_id: outgoingPending.id,
    current_version: 3,
  }),
  SUBSTITUTION_NOT_PENDING: errorFixture('SUBSTITUTION_NOT_PENDING', 'This arrangement was cancelled or already completed.', {
    request_id: cancelled.id,
  }),
  DRIVER_UNAVAILABLE: errorFixture('DRIVER_UNAVAILABLE', 'The incoming driver is reserved on another trip in that window.'),
  INCOMING_DRIVER_INACTIVE: errorFixture('INCOMING_DRIVER_INACTIVE', 'The incoming driver account is inactive.'),
  LICENCE_INVALID: errorFixture('LICENCE_INVALID', 'The incoming driver licence expiry is missing or has passed.'),
  IDENTITY_ATTESTATION_FORBIDDEN: errorFixture('IDENTITY_ATTESTATION_FORBIDDEN', 'Only an administrator can record an identity exception.'),
  IDENTITY_NOT_VERIFIED: errorFixture('IDENTITY_NOT_VERIFIED', 'The incoming driver identity is not verified.'),
  IDEMPOTENCY_KEY_REUSED: errorFixture('IDEMPOTENCY_KEY_REUSED', 'This request ID was already used with different content.'),
  EVIDENCE_ALREADY_RECORDED: errorFixture('EVIDENCE_ALREADY_RECORDED', 'This evidence was already recorded.', {
    evidence_id: fx(980),
  }),
  SUBSTITUTIONS_DISABLED: errorFixture('SUBSTITUTIONS_DISABLED', 'New driver handovers are temporarily unavailable.'),
}

export type SubstitutionMatrixAction =
  | 'arrange_or_replace'
  | 'driver_confirmation'
  | 'dispatcher_complete'
  | 'mutation_on_pending_request'
  | 'idempotent_mutation'
  | 'live_trip_write'
  | 'exact_replay'

export interface SubstitutionEndpointOutcome {
  endpoint: string
  action: SubstitutionMatrixAction
  outcome: string
  http_status: number
  code: SubstitutionErrorCode | null
}

const ARRANGE = 'POST /trips/{trip_id}/driver-substitutions (or /{request_id}/replace)'
const CONFIRM = 'POST /trips/me/{trip_id}/driver-substitutions/{request_id}/confirmations'
const COMPLETE = 'POST /trips/{trip_id}/driver-substitutions/{request_id}/complete'
const MUTATE = 'POST confirmations | cancel | replace | complete'
const LIVE = 'existing live trip write (phase, checkpoint, location, exception, artifact)'

export const SUBSTITUTION_ENDPOINT_MATRIX: readonly SubstitutionEndpointOutcome[] = [
  { endpoint: ARRANGE, action: 'arrange_or_replace', outcome: 'new arrangements disabled', http_status: 503, code: 'SUBSTITUTIONS_DISABLED' },
  { endpoint: ARRANGE, action: 'arrange_or_replace', outcome: 'incoming account inactive', http_status: 409, code: 'INCOMING_DRIVER_INACTIVE' },
  { endpoint: ARRANGE, action: 'arrange_or_replace', outcome: 'licence missing or expired', http_status: 409, code: 'LICENCE_INVALID' },
  { endpoint: ARRANGE, action: 'arrange_or_replace', outcome: 'reservation conflict', http_status: 409, code: 'DRIVER_UNAVAILABLE' },
  { endpoint: ARRANGE, action: 'arrange_or_replace', outcome: 'identity pending or failed: saved with truthful status, grants no custody', http_status: 201, code: null },
  { endpoint: CONFIRM, action: 'driver_confirmation', outcome: 'capture saved, all checks satisfied, both confirmations present: completed', http_status: 200, code: null },
  { endpoint: CONFIRM, action: 'driver_confirmation', outcome: 'capture saved but completion blocked or one confirmation absent: pending', http_status: 200, code: null },
  { endpoint: COMPLETE, action: 'dispatcher_complete', outcome: 'all checks pass and required captures or attestations exist', http_status: 200, code: null },
  { endpoint: COMPLETE, action: 'dispatcher_complete', outcome: 'FAILED identity or PENDING without valid admin attestation', http_status: 409, code: 'IDENTITY_NOT_VERIFIED' },
  { endpoint: COMPLETE, action: 'dispatcher_complete', outcome: 'non-admin supplies identity_unavailable_reason', http_status: 403, code: 'IDENTITY_ATTESTATION_FORBIDDEN' },
  { endpoint: COMPLETE, action: 'dispatcher_complete', outcome: 'incoming driver inactive', http_status: 409, code: 'INCOMING_DRIVER_INACTIVE' },
  { endpoint: COMPLETE, action: 'dispatcher_complete', outcome: 'licence invalid', http_status: 409, code: 'LICENCE_INVALID' },
  { endpoint: COMPLETE, action: 'dispatcher_complete', outcome: 'reservation conflict', http_status: 409, code: 'DRIVER_UNAVAILABLE' },
  { endpoint: MUTATE, action: 'mutation_on_pending_request', outcome: 'request version changed', http_status: 409, code: 'SUBSTITUTION_VERSION_CHANGED' },
  { endpoint: MUTATE, action: 'mutation_on_pending_request', outcome: 'request no longer pending', http_status: 409, code: 'SUBSTITUTION_NOT_PENDING' },
  { endpoint: 'any idempotent mutation', action: 'idempotent_mutation', outcome: 'same actor, action and key with a changed body', http_status: 409, code: 'IDEMPOTENCY_KEY_REUSED' },
  { endpoint: LIVE, action: 'live_trip_write', outcome: 'former actor', http_status: 409, code: 'TRIP_HANDED_OVER' },
  { endpoint: LIVE, action: 'live_trip_write', outcome: 'stale custody sequence', http_status: 409, code: 'CUSTODY_CONTEXT_CHANGED' },
  { endpoint: LIVE, action: 'live_trip_write', outcome: 'required custody sequence missing after a transfer', http_status: 409, code: 'CUSTODY_CONTEXT_REQUIRED' },
  { endpoint: LIVE, action: 'live_trip_write', outcome: 'proven actor-bound exact accepted replay after transfer', http_status: 409, code: 'EVIDENCE_ALREADY_RECORDED' },
  { endpoint: 'arrange | artifact | late evidence | correction', action: 'exact_replay', outcome: 'exact accepted replay: original success status, no second side effect', http_status: 201, code: null },
]

const arrangeBody: ArrangeSubstitutionRequest = {
  client_request_id: fx(520),
  incoming_driver_id: INCOMING_ID,
  exchange,
  expected_at: T.expected,
  is_planned: true,
  reason: 'Outgoing driver reaches the legal driving-hours limit at Harrismith.',
}
const cancelBody: CancelSubstitutionRequest = { client_request_id: fx(521), expected_version: 1, reason: 'Trip rerouted; handover no longer needed.' }
const replaceBody: ReplaceSubstitutionRequest = {
  ...arrangeBody,
  client_request_id: fx(522),
  expected_version: 1,
  incoming_driver_id: THIRD_ID,
  replacement_reason: 'Incoming driver fell ill.',
  reason: 'Third driver covers the Harrismith exchange.',
}
const completeBody = (over: Partial<CompleteSubstitutionRequest> = {}): CompleteSubstitutionRequest => ({
  client_request_id: fx(523),
  expected_version: 2,
  missing_confirmation_reason: null,
  identity_unavailable_reason: null,
  declared_exchange_at: null,
  ...over,
})
const correctBody: CorrectSubstitutionRequest = {
  client_request_id: fx(524),
  reason: 'Exchange label misspelt',
  correction_note: 'The exchange took place at the Harrismith Engen, not the Shell forecourt named in the label.',
}
const acknowledgeBody: AcknowledgeLateEvidenceRequest = { client_request_id: fx(525), note: 'Reviewed the photo; consistent with the recorded handover.' }

export const substitutionRequestBodyFixtures = {
  arrange: arrangeBody,
  cancel: cancelBody,
  replace: replaceBody,
  confirm: confirmBody(),
  completeNormalRecheck: completeBody(),
  completeMissingConfirmationAttested: completeBody({ missing_confirmation_reason: 'Outgoing driver phone is dead; confirmed by radio.' }),
  completeIdentityAttestedByAdmin: completeBody({ identity_unavailable_reason: 'Fleet verification service unavailable; identity checked in person.' }),
  correct: correctBody,
  acknowledge: acknowledgeBody,
  lateEvidence: lateRequests,
} as const

export const substitutionFixturePack = {
  noSubstitution,
  outgoingPending,
  immediatePending: { ...outgoingPending, exchange: null, expected_at: null, is_planned: null,
    request_format: 'immediate_v2' as const, confirmation_policy: 'incoming_acceptance_v2' as const,
    required_confirmation_roles: ['incoming'] as SubstitutionRole[], reservation_start_at: T.arranged,
    missing_confirmations: ['incoming'] as SubstitutionRole[], permitted_actions: [] },
  incomingPendingNoActiveTrip: { active_trip: null, pending: [incomingPending] },
  oneConfirmation,
  normalCompleted,
  dispatcherAttestedCompleted,
  identityUnavailableCompleted,
  cancelled,
  replaced: { old: replacedOld, replacement },
  formerParticipantHistory: { history: formerHistory, access: formerAccess, current_driver_access: currentAccessAfterTransfer, original_driver_access: originalDriverAccess },
  lateEvidence: { awaiting: lateAwaiting, acknowledged: lateAcknowledged, detail: lateDetail, requests: lateRequests },
  notApplicableSealReason: {
    seal_check: notApplicableSeal,
    confirm_request: confirmBody({ seal_checks: [intactSeal(HORSE_ID, PHOTO_HORSE, 'AB-1234'), notApplicableSeal] }),
    no_position_request: confirmBody({ latitude: null, longitude: null, accuracy_metres: null }),
  },
  identityFailed,
  licenceMissing: { request: blockedConfirmationFixtures.licence_invalid.body, incoming_driver: { ...incomingFleetRecord, license_expiry: null } },
  licenceExpired: { request: blockedConfirmationFixtures.licence_invalid.body, incoming_driver: { ...incomingFleetRecord, license_expiry: '2026-10-19' } },
  savedButBlocked: blockedConfirmationFixtures.identity_not_verified.body,
  contextWithFindings,
  clarification,
  custodyIntegrityPending,
  custodyIntegrityFailed,
  flagOffDetail,
}
