// Scenario trips for the dev design page (app/dev/design/_timeline-scenarios): the hard cases of
// the live evidence rail, built as real `Trip` records so the REAL TripTimeline and
// TripExceptionsPanel can render them. Nothing here is mocked UI: each scenario is data, and
// what it shows is whatever the production components make of it.
//
// Plans come from makePhasePlan (shared/lib/mocks/phase-trips.ts), the one generator, so a
// scenario can never hold a plan the backend would not write. Everything is synthetic: names,
// numbers, hashes and the JPEGs under public/dev-fixtures (generated drawings, not photographs).
//
// Times are relative to an `anchorMs` the caller supplies (the page passes "now" on mount), so a
// live leg's "time on the road" reads as a believable duration instead of a number of days.

import type { BlockchainReceipt, BlockchainReceiptType } from '@shared/lib/types/blockchain'
import type { ArtifactId, ArtifactType, EvidenceArtifactWithUrl, EvidenceRole } from '@shared/lib/types/evidence'
import type { ExceptionContactMethod, ExceptionId, ExceptionReviewOutcome, ExceptionReviewStatus, ExceptionSeverity, ExceptionSource, ExceptionType, TripException } from '@shared/lib/types/exception'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import type { PhaseDescriptor, PhaseEventId, PhaseType } from '@shared/lib/types/phase'
import type { Precinct, PrecinctId } from '@shared/lib/types/precinct'
import type { ConsignmentRead, Trip, TripId, TripStatus, TripStop } from '@shared/lib/types/trip'
import { EVIDENCE_ROLE_FIELD } from '@shared/lib/constants/phase-meta'
import {
  CGY_ORG_ID, DRIVER_FORMBY_ID, FEDEX_ORG_ID, HORSE_1_ID, TRAILER_1_ID, mockDrivers, mockHorses, mockPrecincts, mockTrailers,
  PRECINCT_CGY_CT_ID, PRECINCT_CGY_JHB_ID, PRECINCT_FEDEX_DBN_ID, PRECINCT_FEDEX_JHB_ID,
} from '@shared/lib/mocks'
import { makePhasePlan, type PlanStopInput } from '@shared/lib/mocks/phase-trips'
import { activePhase } from '@/lib/phase/derive'

// ── Public surface ───────────────────────────────────────────────────────────────

/** Served from frontend/dispatcher/public/dev-fixtures. Generated drawings, not photographs. */
export const FIXTURE_IMAGES = {
  sealPortrait: '/dev-fixtures/seal-portrait.jpg',
  linehaulLandscape: '/dev-fixtures/linehaul-landscape.jpg',
  sealDark: '/dev-fixtures/seal-dark.jpg',
  receiverSignature: '/dev-fixtures/receiver-signature.jpg',
} as const
type FixtureImage = keyof typeof FIXTURE_IMAGES

/** Stable ids and the order the page lists them in. */
export const SCENARIO_IDS = [
  'normal-single-leg',
  'cross-dock-13-phase',
  'four-stop-three-legs',
  'transit-active-critical',
  'transit-resolved-none',
  'transit-resolved-reviewed',
  'offline-arrival',
  'three-seal-uploads',
  'tracker-dark',
  'parcel-count-failed',
  'cancelled-mid-phase',
  'cancelled-en-route',
  'evidence-metadata-unavailable',
  'photo-absent',
  'phase-overridden',
  'anchor-pending',
  'anchor-failed',
  'signature-unattributed',
  'fifteen-exceptions',
  'long-exception-description',
  'long-precinct-name',
] as const
export type ScenarioId = typeof SCENARIO_IDS[number]

export interface TimelineScenario {
  id: ScenarioId
  title: string
  /** One sentence on what the scenario exists to prove, shown under its heading. */
  demonstrates: string
  trip: Trip
  /** Every artifact the page would have loaded for this trip (the timeline reads them by id). */
  artifacts: EvidenceArtifactWithUrl[]
  precincts: Precinct[]
}

/** The lookup the timeline and the exceptions panel take. */
export function artifactsByIdOf(scenario: TimelineScenario): Map<string, EvidenceArtifactWithUrl> {
  return new Map(scenario.artifacts.map(artifact => [artifact.id as string, artifact]))
}

/** The anchor the smoke test builds against; the page passes the real "now". */
export const FIXTURE_ANCHOR_MS = Date.parse('2026-10-13T09:00:00Z')
/** The brief asks for a 400-character description; the fixture and its test both cite this. */
export const FIXTURE_LONG_DESCRIPTION_LENGTH = 400

// ── Constants ────────────────────────────────────────────────────────────────────

const MS_PER_MINUTE = 60_000
const MS_PER_SECOND = 1_000
const MINUTES_PER_HOUR = 60
const minutes = (n: number): number => n * MS_PER_MINUTE
const iso = (ms: number): string => new Date(ms).toISOString()

const DEFAULT_STEP_MIN = 40
const DEFAULT_TAIL_MIN = 12
const PLAN_LEAD_HOURS = 2
const PLANNED_ARRIVAL_HOURS_AHEAD = 3
const PLANNED_DEPARTURE_LEAD_MIN = 15
const CAPTURE_LEAD_MIN = 4
const UPLOAD_LAG_SECONDS = 30
const DRIVER_CONFIRM_LEAD_SECONDS = 60
const REVIEW_DELAY_MIN = 30
const EXCEPTION_GAP_MIN = 5
const RECEIPT_DELAY_MIN = 2
const OFFLINE_CAPTURE_LEAD_MIN = 60
const OFFLINE_CONFIRM_LEAD_MIN = 55
const OFFLINE_UPLOAD_LEAD_MIN = 1

const HASH_LENGTH = 64
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const HEX_RADIX = 16
const HEX_WORD_WIDTH = 8

// Policy numbers an assessment records beside its verdict; the preview only needs them present.
const ASSESSMENT_POLICY_VERSION = 'preview-1'
const ASSESSMENT_MAX_SEPARATION_M = 150
const ASSESSMENT_MAX_AGE_S = 120
const ASSESSMENT_MAX_SKEW_S = 60
const ASSESSMENT_MAX_PHONE_ACCURACY_M = 50
const ASSESSMENT_TOLERANCE_M = 50
const DRIVER_OFFSET_DEG = 0.0003
const TRACKER_OFFSET_DEG = 0.0001
const COINCIDENT_SEPARATION_M = 40

const HEDERA_TOPIC = '0.0.4829301'
const HEDERA_FIRST_SEQUENCE = 1842
const REVIEWER_ID = 'preview-reviewer-01'
const REVIEWER_NAME = 'Preview Reviewer'
const OVERRIDE_USER_ID = 'preview-dispatcher-01'

const RECEIPT_TYPE: Record<PhaseType, BlockchainReceiptType> = {
  trip_creation: 'journey_lock',
  activation: 'activation',
  loading: 'loading',
  departure: 'pickup',
  in_transit: 'transit_arrival',
  arrival: 'arrival_inspection',
  unloading: 'unloading',
  confirmation: 'delivery',
}

/** What a phase of each type submits when it completes, and which drawing stands in for it. */
const CAPTURES: Partial<Record<PhaseType, ReadonlyArray<{ role: EvidenceRole; image: FixtureImage }>>> = {
  loading: [{ role: 'linehaul_photo', image: 'linehaulLandscape' }],
  departure: [{ role: 'seal_photo', image: 'sealPortrait' }],
  arrival: [{ role: 'seal_photo', image: 'sealDark' }],
  confirmation: [
    { role: 'pod_photo', image: 'linehaulLandscape' },
    { role: 'pod_signature', image: 'receiverSignature' },
  ],
}

// ── Precincts ────────────────────────────────────────────────────────────────────

function longNamePrecinct(suffix: string, name: string, address: string, latitude: number, longitude: number): Precinct {
  return {
    id: `f0000000-0000-4000-8000-0000000000${suffix}` as PrecinctId,
    name,
    principal_organization_id: FEDEX_ORG_ID,
    address,
    latitude,
    longitude,
    geofence_radius_metres: 400,
    is_shared: false,
    created_at: '2024-06-01T08:00:00Z',
  }
}

// precinctLabel() keeps the text before the em dash, so the long part goes before it.
const LONG_ORIGIN = longNamePrecinct(
  'a1',
  'Gauteng North Regional Distribution and Cross-Dock Centre, Phase 2 Annex (Bays 14 to 22) — Midrand',
  'Portion 12 of Erf 4087, Old Pretoria Main Road, Halfway House Extension 9, Midrand, Gauteng, 1685',
  -25.9895,
  28.1283,
)
const LONG_DESTINATION = longNamePrecinct(
  'a2',
  'Eastern Seaboard Consolidated Freight Terminal and Bonded Warehouse Complex, Block C (Cold Chain) — Pinetown',
  'Unit 7, Block C, Shepstone Industrial Park, Old Main Road, Pinetown, KwaZulu-Natal, 3610',
  -29.8161,
  30.8566,
)

export const FIXTURE_PRECINCTS: readonly Precinct[] = [...mockPrecincts, LONG_ORIGIN, LONG_DESTINATION]

// ── Draft: the mutable shape a scenario is assembled in ──────────────────────────

interface Cargo { from: number; to: number; parcels: number }
interface Clock { anchorMs: number; tailMs: number; stepMs: number; through: number }

interface Draft {
  id: ScenarioId
  trip: Trip
  artifacts: EvidenceArtifactWithUrl[]
  cargo: readonly Cargo[]
  clock: Clock
}

interface DraftOptions {
  id: ScenarioId
  route: readonly Precinct[]
  cargo: readonly Cargo[]
  status: TripStatus
  /** The highest sequence_number the ledger has resolved; -1 for a plan nothing has started. */
  through: number
  anchorMs: number
  tailMin?: number
  stepMin?: number
}

const SINGLE_CARGO: readonly Cargo[] = [{ from: 0, to: 1, parcels: 24 }]
// Consignment A runs 1 to 3, B 1 to 2, C 2 to 3: stop 2 both drops off and picks up.
const CROSS_DOCK_CARGO: readonly Cargo[] = [{ from: 0, to: 2, parcels: 10 }, { from: 0, to: 1, parcels: 8 }, { from: 1, to: 2, parcels: 6 }]
const CHAIN_CARGO: readonly Cargo[] = [{ from: 0, to: 1, parcels: 18 }, { from: 1, to: 2, parcels: 12 }, { from: 2, to: 3, parcels: 9 }]

const SINGLE_ROUTE: readonly Precinct[] = routeOf([PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID])
const CROSS_DOCK_ROUTE: readonly Precinct[] = routeOf([PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, PRECINCT_CGY_CT_ID])
const CHAIN_ROUTE: readonly Precinct[] = routeOf([PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, PRECINCT_CGY_JHB_ID, PRECINCT_CGY_CT_ID])

function routeOf(ids: readonly PrecinctId[]): Precinct[] {
  return ids.map(id => {
    const precinct = FIXTURE_PRECINCTS.find(candidate => candidate.id === id)
    if (!precinct) throw new Error(`fixture precinct ${id} is missing`)
    return precinct
  })
}

function first<T>(items: readonly T[], what: string): T {
  const item = items[0]
  if (item === undefined) throw new Error(`fixture ${what} is missing`)
  return item
}

function phaseMs(clock: Clock, sequence: number): number {
  return clock.anchorMs - clock.tailMs - (clock.through - sequence) * clock.stepMs
}

function fakeHash(seed: string): string {
  let state = FNV_OFFSET
  let out = ''
  while (out.length < HASH_LENGTH) {
    for (const char of `${seed}${out.length}`) state = Math.imul(state ^ char.charCodeAt(0), FNV_PRIME) >>> 0
    out += state.toString(HEX_RADIX).padStart(HEX_WORD_WIDTH, '0')
  }
  return out.slice(0, HASH_LENGTH)
}

function newDraft(options: DraftOptions): Draft {
  const { id, route, cargo, status, through, anchorMs } = options
  const clock: Clock = {
    anchorMs, through,
    tailMs: minutes(options.tailMin ?? DEFAULT_TAIL_MIN),
    stepMs: minutes(options.stepMin ?? DEFAULT_STEP_MIN),
  }
  const index = SCENARIO_IDS.indexOf(id)
  const tripId = `preview-${id}`
  const createdMs = phaseMs(clock, -1) - PLAN_LEAD_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE
  const created = iso(createdMs)
  const stops: TripStop[] = route.map((precinct, position) => ({
    id: `${id}-stop-${position + 1}`,
    trip_id: tripId,
    precinct_id: precinct.id,
    sequence: position + 1,
    slot_time: null,
    notes: null,
    created_at: created,
    updated_at: created,
  }))
  const planStops: PlanStopInput[] = stops.map((stop, position) => ({
    trip_stop_id: stop.id,
    sequence: stop.sequence,
    picks_up: cargo.some(item => item.from === position),
    drops_off: cargo.some(item => item.to === position),
  }))
  const stopId = (position: number): string => {
    const stop = stops[position]
    if (!stop) throw new Error(`fixture ${id} has no stop ${position}`)
    return stop.id
  }
  const consignments: ConsignmentRead[] = cargo.map((item, position) => ({
    id: `${id}-consignment-${position + 1}`,
    trip_id: tripId,
    parcel_perfect_reference: `PP-PREVIEW-${index + 1}-${position + 1}`,
    client_organization_id: null,
    origin_precinct_id: route[item.from]?.id ?? null,
    destination_precinct_id: route[item.to]?.id ?? null,
    declared_value: null,
    parcel_count_expected: item.parcels,
    slot_time_origin: null,
    slot_time_destination: null,
    pp_raw_json: null,
    pickup_stop_id: stopId(item.from),
    delivery_stop_id: stopId(item.to),
    load_priority: null,
    unit_count_expected: null,
    pp_manifest_number: null,
    scanned_out_count: 0,
    scanned_in_count: 0,
    created_at: created,
    updated_at: created,
  }))
  const trip: Trip = {
    id: tripId as TripId,
    trip_reference: `TRP-PREVIEW-${String(index + 1).padStart(2, '0')}`,
    pp_manifest: { issuer_account: 'FDX001', origin_hub: 'JNB', number: 9000 + index, display: `FedEx South Africa · JNB ${9000 + index}` },
    status,
    trip_type: 'loaded',
    journey_lock_hash: fakeHash(`${id}:journey`),
    idvs_check_status: 'verified',
    origin_precinct_id: first(route, 'origin').id,
    destination_precinct_id: (route[route.length - 1] ?? first(route, 'destination')).id,
    stops,
    consignments,
    pulsit_trip_reference_id: `PLT-PREVIEW-${index + 1}`,
    planned_departure_at: null,
    actual_departure_at: null,
    planned_arrival_at: iso(anchorMs + PLANNED_ARRIVAL_HOURS_AHEAD * MINUTES_PER_HOUR * MS_PER_MINUTE),
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(driver => driver.id === DRIVER_FORMBY_ID) ?? null,
    horse: mockHorses.find(horse => horse.id === HORSE_1_ID) ?? null,
    trailers: mockTrailers.filter(trailer => trailer.id === TRAILER_1_ID),
    phases: makePhasePlan(tripId, planStops, created, id),
    current_phase: null,
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: created,
    updated_at: created,
  }
  return { id, trip, artifacts: [], cargo, clock }
}

function phaseAt(draft: Draft, sequence: number): PhaseDescriptor {
  const phase = draft.trip.phases[sequence]
  if (!phase) throw new Error(`fixture ${draft.id} has no phase ${sequence}`)
  return phase
}

function phaseOfType(draft: Draft, type: PhaseType, nth = 0): PhaseDescriptor {
  const phase = draft.trip.phases.filter(candidate => candidate.phase_type === type)[nth]
  if (!phase) throw new Error(`fixture ${draft.id} has no ${type} #${nth}`)
  return phase
}

function setPhase(draft: Draft, phase: PhaseDescriptor, changes: Partial<PhaseDescriptor>): PhaseDescriptor {
  const next = { ...phase, ...changes }
  draft.trip.phases[phase.sequence_number] = next
  return next
}

function stopPosition(draft: Draft, phase: PhaseDescriptor): number {
  return draft.trip.stops.findIndex(stop => stop.id === phase.trip_stop_id)
}

function precinctOf(draft: Draft, phase: PhaseDescriptor): Precinct | undefined {
  const stop = draft.trip.stops[stopPosition(draft, phase)]
  return FIXTURE_PRECINCTS.find(precinct => precinct.id === stop?.precinct_id)
}

// ── Artifacts ────────────────────────────────────────────────────────────────────

interface ArtifactSpec {
  key: string
  image: FixtureImage
  /** Both halves of the attribution pair, or neither (an exception photo, an older app). */
  phase: PhaseDescriptor | null
  role: EvidenceRole | null
  takenMs: number
  receivedMs?: number
  /** The receiver's own confirmation: nothing the driver's phone captured. */
  byReceiver?: boolean
}

function artifactId(draft: Draft, key: string): ArtifactId {
  return `${draft.id}-art-${key}` as ArtifactId
}

function addArtifact(draft: Draft, spec: ArtifactSpec): EvidenceArtifactWithUrl {
  const id = artifactId(draft, spec.key)
  const isDocument = spec.role === 'pod_signature'
  const type: ArtifactType = isDocument ? 'document' : 'photo'
  const artifact: EvidenceArtifactWithUrl = {
    id,
    trip_id: draft.trip.id,
    artifact_type: type,
    s3_key: `preview/${id}.jpg`,
    s3_bucket: 'preview',
    file_hash: fakeHash(id),
    mime_type: 'image/jpeg',
    captured_at: iso(spec.takenMs),
    captured_by_driver_id: spec.byReceiver ? null : draft.trip.driver?.id ?? null,
    captured_by_user_id: null,
    captured_lat: null,
    captured_lng: null,
    created_at: iso(spec.receivedMs ?? spec.takenMs + UPLOAD_LAG_SECONDS * MS_PER_SECOND),
    phase_event_id: spec.phase?.phase_event_id ?? null,
    evidence_role: spec.role,
    signed_url: FIXTURE_IMAGES[spec.image],
  }
  draft.artifacts.push(artifact)
  return artifact
}

// ── Exceptions ───────────────────────────────────────────────────────────────────

interface ExceptionSpec {
  key: string
  /** Null is a trip-level record. */
  phase: PhaseDescriptor | null
  type: ExceptionType
  severity: ExceptionSeverity
  source: ExceptionSource
  description: string
  atMs: number
  review?: ExceptionReviewStatus
  outcome?: ExceptionReviewOutcome
  note?: string
  contact?: ExceptionContactMethod
  supportingArtifactId?: string
  gps?: { lat: number; lng: number }
}

function raise(draft: Draft, spec: ExceptionSpec): TripException {
  const review = spec.review ?? 'needs_review'
  const reviewed = review === 'reviewed'
  const exception: TripException = {
    id: `${draft.id}-exc-${spec.key}` as ExceptionId,
    trip_id: draft.trip.id,
    trip_reference: draft.trip.trip_reference,
    exception_type: spec.type,
    source: spec.source,
    severity: spec.severity,
    description: spec.description,
    phase_event_id: spec.phase?.phase_event_id ?? null,
    checkpoint_id: null,
    supporting_artifact_id: spec.supportingArtifactId ?? null,
    gps_lat: spec.gps?.lat ?? null,
    gps_lng: spec.gps?.lng ?? null,
    vehicle_id: null,
    review_status: review,
    // A dispatcher's own note is saved already reviewed by its author, with its own marker.
    review_outcome: reviewed ? (spec.source === 'dispatcher' ? 'dispatcher_authored' : spec.outcome ?? 'no_action_required') : null,
    reviewed_by_user_id: reviewed ? REVIEWER_ID : null,
    reviewed_at: reviewed ? iso(spec.atMs + minutes(REVIEW_DELAY_MIN)) : null,
    review_note: reviewed ? spec.note ?? null : null,
    contact_method: reviewed ? spec.contact ?? null : null,
    merkle_batch_id: null,
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_name: null,
    reviewed_by_name: reviewed ? REVIEWER_NAME : null,
    action_location_assessment: null,
    created_at: iso(spec.atMs),
    updated_at: iso(spec.atMs),
  }
  draft.trip.exceptions.push(exception)
  return exception
}

// ── Walking the plan ─────────────────────────────────────────────────────────────

/** How one submitted capture is recorded. */
type CaptureMode =
  /** Attributed to the phase and cited by its column. */
  | 'normal'
  /** Nothing was submitted and nothing was uploaded. */
  | 'absent'
  /** The column cites an id the artifact list does not carry (metadata did not load). */
  | 'metadata_missing'
  /** Cited, but the artifact carries no attribution (an older driver app). */
  | 'unattributed'
  /** Taken while offline and uploaded about an hour later. */
  | 'offline'

interface WalkOptions {
  capture?: (phase: PhaseDescriptor, role: EvidenceRole) => CaptureMode
  /** `dark`: the tracker returned nothing, so no precinct verdict and no assessment exist. */
  tracker?: 'verified' | 'dark'
}

function assessmentFor(draft: Draft, phase: PhaseDescriptor, precinct: Precinct, atMs: number): ActionLocationAssessment {
  return {
    schema_version: 1,
    policy_version: ASSESSMENT_POLICY_VERSION,
    evaluated_at: iso(atMs),
    driver_lat: precinct.latitude + DRIVER_OFFSET_DEG,
    driver_lng: precinct.longitude + DRIVER_OFFSET_DEG,
    driver_captured_at: iso(atMs - DRIVER_CONFIRM_LEAD_SECONDS * MS_PER_SECOND),
    driver_accuracy_metres: ASSESSMENT_MAX_PHONE_ACCURACY_M / 2,
    tracker_lat: precinct.latitude + TRACKER_OFFSET_DEG,
    tracker_lng: precinct.longitude + TRACKER_OFFSET_DEG,
    tracker_captured_at: iso(atMs - DRIVER_CONFIRM_LEAD_SECONDS * MS_PER_SECOND),
    separation_metres: COINCIDENT_SEPARATION_M,
    proximity: 'within_limit',
    reasons: [],
    max_separation_metres: ASSESSMENT_MAX_SEPARATION_M,
    max_age_seconds: ASSESSMENT_MAX_AGE_S,
    max_skew_seconds: ASSESSMENT_MAX_SKEW_S,
    max_phone_accuracy_metres: ASSESSMENT_MAX_PHONE_ACCURACY_M,
    expected_trip_stop_id: phase.trip_stop_id,
    precinct_id: precinct.id,
    precinct_lat: precinct.latitude,
    precinct_lng: precinct.longitude,
    precinct_radius_metres: precinct.geofence_radius_metres,
    precinct_tolerance_metres: ASSESSMENT_TOLERANCE_M,
    driver_in_precinct: true,
    truck_in_precinct: true,
  }
}

function locationFields(draft: Draft, phase: PhaseDescriptor, atMs: number): Partial<PhaseDescriptor> {
  const precinct = precinctOf(draft, phase)
  if (!precinct) return {}
  return {
    driver_phone_lat: precinct.latitude + DRIVER_OFFSET_DEG,
    driver_phone_lng: precinct.longitude + DRIVER_OFFSET_DEG,
    horse_gps_lat: precinct.latitude + TRACKER_OFFSET_DEG,
    horse_gps_lng: precinct.longitude + TRACKER_OFFSET_DEG,
    pulsit_geofence_confirmed: true,
    driver_captured_at: iso(atMs - DRIVER_CONFIRM_LEAD_SECONDS * MS_PER_SECOND),
    action_location_assessment: assessmentFor(draft, phase, precinct, atMs),
  }
}

function receiptFor(draft: Draft, phase: PhaseDescriptor, atMs: number): BlockchainReceipt {
  const id = `${draft.id}-receipt-${phase.sequence_number}`
  return {
    id,
    subject_type: phase.phase_type === 'trip_creation' ? 'trip' : 'phase_event',
    subject_id: phase.phase_type === 'trip_creation' ? draft.trip.id : phase.phase_event_id,
    receipt_type: RECEIPT_TYPE[phase.phase_type],
    data_hash: fakeHash(id),
    hedera_topic_id: HEDERA_TOPIC,
    hedera_sequence_number: HEDERA_FIRST_SEQUENCE + phase.sequence_number,
    hedera_consensus_timestamp: iso(atMs + minutes(RECEIPT_DELAY_MIN)),
    hedera_tx_id: null,
    created_at: iso(atMs + minutes(RECEIPT_DELAY_MIN / 2)),
  }
}

function sumCargo(draft: Draft, side: 'from' | 'to', position: number): number {
  return draft.cargo.filter(item => item[side] === position).reduce((total, item) => total + item.parcels, 0)
}

/** Submits (or deliberately does not submit) one capture of a completing phase. */
function submitCapture(draft: Draft, phase: PhaseDescriptor, role: EvidenceRole, image: FixtureImage, mode: CaptureMode, atMs: number): Partial<PhaseDescriptor> {
  if (mode === 'absent') return {}
  const key = `${phase.sequence_number}-${role}`
  const column = EVIDENCE_ROLE_FIELD[role]
  if (mode === 'metadata_missing') return { [column]: artifactId(draft, key) }
  const offline = mode === 'offline'
  const artifact = addArtifact(draft, {
    key,
    image,
    phase: mode === 'unattributed' ? null : phase,
    role: mode === 'unattributed' ? null : role,
    takenMs: atMs - minutes(offline ? OFFLINE_CAPTURE_LEAD_MIN : CAPTURE_LEAD_MIN),
    receivedMs: offline ? atMs - minutes(OFFLINE_UPLOAD_LEAD_MIN) : undefined,
    byReceiver: role === 'pod_signature',
  })
  return { [column]: artifact.id }
}

/** Resolves every phase up to `clock.through` as a healthy run would leave it. A scenario then
 *  bends the one thing it exists to show. */
function walk(draft: Draft, options: WalkOptions = {}): void {
  const { capture = () => 'normal', tracker = 'verified' } = options
  for (let sequence = 0; sequence <= draft.clock.through; sequence += 1) {
    const phase = phaseAt(draft, sequence)
    const atMs = phaseMs(draft.clock, sequence)
    const type = phase.phase_type
    const receipt = receiptFor(draft, phase, atMs)
    let changes: Partial<PhaseDescriptor> = {
      status: 'completed',
      completed_at: iso(atMs),
      updated_at: iso(atMs),
      anchor_status: 'anchored',
      event_hash: fakeHash(`${phase.phase_event_id}:event`),
      blockchain_receipt_id: type === 'trip_creation' ? null : receipt.id,
    }
    draft.trip.blockchain_receipts.push(receipt)
    const position = stopPosition(draft, phase)
    if (type !== 'trip_creation' && type !== 'in_transit' && tracker === 'verified') changes = { ...changes, ...locationFields(draft, phase, atMs) }
    if (type === 'loading') {
      const parcels = sumCargo(draft, 'from', position)
      changes = { ...changes, parcel_count_origin: parcels, driver_visual_count: parcels }
      draft.trip.consignments = draft.trip.consignments.map(item => item.pickup_stop_id === phase.trip_stop_id ? { ...item, scanned_out_count: item.parcel_count_expected ?? 0 } : item)
    }
    if (type === 'unloading') {
      draft.trip.consignments = draft.trip.consignments.map(item => item.delivery_stop_id === phase.trip_stop_id ? { ...item, scanned_in_count: item.parcel_count_expected ?? 0 } : item)
    }
    if (type === 'departure') changes = { ...changes, seal_number: `FP-48210${position + 1}` }
    if (type === 'arrival') changes = { ...changes, seal_number: `FP-48210${position}`, seal_condition: 'intact' }
    if (type === 'confirmation') changes = { ...changes, parcel_count_destination: sumCargo(draft, 'to', position) }
    for (const { role, image } of CAPTURES[type] ?? []) {
      changes = { ...changes, ...submitCapture(draft, phase, role, image, capture(phase, role), atMs) }
    }
    setPhase(draft, phase, changes)
  }
}

/** Takes an anchor back to a state that has no receipt yet. */
function unanchor(draft: Draft, phase: PhaseDescriptor, status: 'pending' | 'failed'): void {
  draft.trip.blockchain_receipts = draft.trip.blockchain_receipts.filter(receipt => receipt.id !== phase.blockchain_receipt_id)
  setPhase(draft, phase, { anchor_status: status, blockchain_receipt_id: null, event_hash: null })
}

/** Fills in the trip fields the ledger derives, then hands the scenario over. */
function finish(draft: Draft, title: string, demonstrates: string): TimelineScenario {
  const { trip, clock } = draft
  const terminal = trip.status === 'closed' || trip.status === 'cancelled'
  const active = terminal ? null : activePhase(trip.phases)
  const departure = trip.phases.find(phase => phase.phase_type === 'departure' && phase.completed_at !== null)
  const lastTransit = trip.phases.filter(phase => phase.phase_type === 'in_transit').at(-1)
  trip.current_phase = active?.phase_type ?? null
  trip.current_stop = active?.stop_sequence ?? null
  trip.planned_departure_at = departure?.completed_at ? iso(Date.parse(departure.completed_at) - minutes(PLANNED_DEPARTURE_LEAD_MIN)) : null
  trip.actual_departure_at = departure?.completed_at ?? null
  trip.actual_arrival_at = lastTransit?.status === 'completed' ? lastTransit.completed_at : null
  if (trip.status === 'closed') trip.closed_at = iso(phaseMs(clock, clock.through) + minutes(REVIEW_DELAY_MIN / 3))
  trip.updated_at = iso(clock.anchorMs)
  return { id: draft.id, title, demonstrates, trip, artifacts: draft.artifacts, precincts: [...FIXTURE_PRECINCTS] }
}

// ── Scenarios ────────────────────────────────────────────────────────────────────

type Builder = (anchorMs: number) => TimelineScenario

const LONG_DESCRIPTION = 'Driver reports the trailer was stopped for 38 minutes at a layby off the N3 near Van Reenen with the engine running and no reason given. '
  + 'On approach the rear doors were closed but the bolt seal head looked scratched, and the driver says two unfamiliar men were standing by a white bakkie parked close to the rear doors. '
  + 'Photographs taken and seal number read to dispatch by phone. Driver waits there.'

const BUILDERS: Record<ScenarioId, Builder> = {
  'normal-single-leg': anchorMs => {
    const draft = newDraft({ id: 'normal-single-leg', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'closed', through: 7, anchorMs, tailMin: 45 })
    walk(draft)
    raise(draft, {
      key: 'note', phase: null, type: 'dispatcher_note', severity: 'info', source: 'dispatcher', review: 'reviewed',
      description: 'Receiver asked for the delivery note to be re-sent by e-mail; sent from the dispatcher desk.',
      atMs: phaseMs(draft.clock, 7) + minutes(5),
    })
    return finish(draft, 'Normal single-leg trip', 'A finished trip where every check agrees: four photographed phases, a receiver confirmation, a trip-level note, and nothing to flag.')
  },

  'cross-dock-13-phase': anchorMs => {
    const draft = newDraft({ id: 'cross-dock-13-phase', route: CROSS_DOCK_ROUTE, cargo: CROSS_DOCK_CARGO, status: 'active', through: 8, anchorMs, tailMin: 70 })
    walk(draft)
    raise(draft, {
      key: 'leg-1-detour', phase: phaseAt(draft, 4), type: 'route_deviation', severity: 'warning', source: 'system', review: 'reviewed',
      description: 'The truck left the planned route for 6 km near Harrismith and rejoined it.',
      atMs: phaseMs(draft.clock, 3) + minutes(20), outcome: 'no_action_required', note: 'Signed detour around roadworks.', contact: 'phone',
    })
    return finish(draft, '13-phase cross-dock, mid-trip', 'The canonical 13-row plan: the first leg resolved, the second leg on the road. Both in_transit cards are open; the live one is the only pulsing node.')
  },

  'four-stop-three-legs': anchorMs => {
    const draft = newDraft({ id: 'four-stop-three-legs', route: CHAIN_ROUTE, cargo: CHAIN_CARGO, status: 'active', through: 13, anchorMs, tailMin: 55 })
    walk(draft)
    return finish(draft, 'Four stops, three in_transit legs', 'The only plan shape with three legs (18 rows): two finished legs and the current one, every in_transit card open, none behind a toggle.')
  },

  'transit-active-critical': anchorMs => {
    const draft = newDraft({ id: 'transit-active-critical', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 3, anchorMs, tailMin: 95 })
    walk(draft)
    const leg = phaseAt(draft, 4)
    const photo = addArtifact(draft, { key: 'seal-broken', image: 'sealPortrait', phase: null, role: null, takenMs: anchorMs - minutes(20) })
    raise(draft, {
      key: 'trailer-separated', phase: leg, type: 'trailer_separated_in_transit', severity: 'critical', source: 'system',
      description: 'The trailer tracker is 1.4 km from the horse tracker with no stop recorded.', atMs: anchorMs - minutes(40),
    })
    raise(draft, {
      key: 'tracker-silent', phase: leg, type: 'tracker_silent', severity: 'warning', source: 'system',
      description: 'No position from the horse tracker for 12 minutes.', atMs: anchorMs - minutes(25),
    })
    raise(draft, {
      key: 'seal-broken', phase: leg, type: 'seal_broken_in_transit', severity: 'critical', source: 'driver',
      description: 'Seal head is cracked and the bolt is loose. Photo attached.', atMs: anchorMs - minutes(20),
      supportingArtifactId: photo.id, gps: { lat: -27.9, lng: 29.4 },
    })
    return finish(draft, 'In transit, active, with a critical exception', 'A live leg with three unreviewed exceptions, two critical: the verdict reads "Needs attention" with the exception rows under it, and the pulse stays on the leg.')
  },

  'transit-resolved-none': anchorMs => {
    const draft = newDraft({ id: 'transit-resolved-none', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 4, anchorMs, tailMin: 25 })
    walk(draft)
    return finish(draft, 'In transit, resolved, no exceptions', 'A finished leg with nothing on record reads "No exceptions recorded", never "Checks passed": an empty list on the road is an absence of reports, not a safe route.')
  },

  'transit-resolved-reviewed': anchorMs => {
    const draft = newDraft({ id: 'transit-resolved-reviewed', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 4, anchorMs, tailMin: 25 })
    walk(draft)
    raise(draft, {
      key: 'detour', phase: phaseAt(draft, 4), type: 'route_deviation', severity: 'warning', source: 'system', review: 'reviewed',
      description: 'The truck left the planned route for 9 km and rejoined it.', atMs: phaseMs(draft.clock, 3) + minutes(15),
      outcome: 'no_action_required', note: 'Roadworks closure on the N3; the driver took the signed detour.', contact: 'phone',
    })
    return finish(draft, 'In transit, resolved, reviewed deviation', 'A finished leg whose one deviation was reviewed: "Exception reviewed", the row carrying who reviewed it and how.')
  },

  'offline-arrival': anchorMs => {
    const draft = newDraft({ id: 'offline-arrival', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 5, anchorMs, tailMin: 20, stepMin: 90 })
    walk(draft, { capture: (phase, role) => phase.phase_type === 'arrival' && role === 'seal_photo' ? 'offline' : 'normal' })
    const arrival = phaseAt(draft, 5)
    setPhase(draft, arrival, { driver_captured_at: iso(phaseMs(draft.clock, 5) - minutes(OFFLINE_CONFIRM_LEAD_MIN)) })
    // The unloading scan is still running, so the live row and its "may still change" note show.
    draft.trip.consignments = draft.trip.consignments.map(item => ({ ...item, scanned_in_count: Math.floor((item.parcel_count_expected ?? 0) * 0.6) }))
    return finish(draft, 'Offline arrival', 'The driver confirmed and photographed at the gate with no signal; the server heard about it later. Every time names its clock: "device clock" for the phone, "server clock" for the record.')
  },

  'three-seal-uploads': anchorMs => {
    const draft = newDraft({ id: 'three-seal-uploads', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 2, anchorMs, tailMin: 12 })
    walk(draft)
    const departure = phaseAt(draft, 3)
    const images: FixtureImage[] = ['sealPortrait', 'sealDark', 'sealPortrait']
    images.forEach((image, index) => addArtifact(draft, {
      key: `retake-${index + 1}`, image, phase: departure, role: 'seal_photo', takenMs: anchorMs - minutes(9 - index * 3),
    }))
    return finish(draft, 'Three seal uploads on the active phase', 'A driver retaking the seal photo twice: one group headed "3 photos uploaded", the first copy shown and the rest behind "+2 more", with the count never lost.')
  },

  'tracker-dark': anchorMs => {
    const draft = newDraft({ id: 'tracker-dark', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 5, anchorMs, tailMin: 20 })
    walk(draft, { tracker: 'dark' })
    return finish(draft, 'Tracker dark (unverified)', 'The truck tracker returned no position for any phase: no precinct verdict was stored, so each phase reads "Not fully verified" and never "Checks passed".')
  },

  'parcel-count-failed': anchorMs => {
    const draft = newDraft({ id: 'parcel-count-failed', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'closed', through: 7, anchorMs, tailMin: 45 })
    walk(draft)
    const shortfall = (SINGLE_CARGO[0]?.parcels ?? 0) - 1
    draft.trip.consignments = draft.trip.consignments.map(item => ({ ...item, scanned_in_count: shortfall }))
    setPhase(draft, phaseOfType(draft, 'confirmation'), { parcel_count_destination: shortfall })
    return finish(draft, 'Failed parcel count, no exception', 'One parcel short at destination and no exception was raised: the Confirmation and Unloading nodes turn amber and name the shortfall, because a fact on the record does not need an exception to be visible.')
  },

  'cancelled-mid-phase': anchorMs => {
    const draft = newDraft({ id: 'cancelled-mid-phase', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'cancelled', through: 2, anchorMs, tailMin: 60 })
    walk(draft)
    const cancelledAtMs = anchorMs - minutes(20)
    draft.trip.closed_at = iso(cancelledAtMs)
    const departure = phaseAt(draft, 3)
    addArtifact(draft, { key: 'seal-before', image: 'sealPortrait', phase: departure, role: 'seal_photo', takenMs: anchorMs - minutes(45) })
    // Uploaded after the cancellation: the record says so instead of treating it as ordinary.
    addArtifact(draft, { key: 'waybill-after', image: 'linehaulLandscape', phase: departure, role: 'waybill_photo', takenMs: anchorMs - minutes(25), receivedMs: anchorMs - minutes(5) })
    return finish(draft, 'Cancelled mid-phase, with uploads', 'A trip cancelled during Departure: the uploads are kept and labelled "Not submitted — trip cancelled", one of them marked as received after the cancellation.')
  },

  'cancelled-en-route': anchorMs => {
    const draft = newDraft({ id: 'cancelled-en-route', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'cancelled', through: 3, anchorMs, tailMin: 80 })
    walk(draft)
    draft.trip.closed_at = iso(anchorMs - minutes(15))
    const leg = phaseAt(draft, 4)
    raise(draft, {
      key: 'mechanical', phase: leg, type: 'mechanical', severity: 'warning', source: 'driver',
      description: 'Engine overheating; pulled in at a truck stop outside Warden.', atMs: anchorMs - minutes(50),
    })
    raise(draft, {
      key: 'panic', phase: leg, type: 'panic_button', severity: 'critical', source: 'driver',
      description: 'Panic button pressed at the truck stop.', atMs: anchorMs - minutes(35), gps: { lat: -27.85, lng: 28.95 },
    })
    return finish(draft, 'Cancelled en-route leg, with exceptions', 'A trip cancelled while the leg was on the road: the leg keeps its exception rows (nothing the dispatcher would otherwise lose), and no verdict claims the leg finished.')
  },

  'evidence-metadata-unavailable': anchorMs => {
    const draft = newDraft({ id: 'evidence-metadata-unavailable', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'closed', through: 7, anchorMs, tailMin: 45 })
    walk(draft, { capture: (phase, role) => phase.phase_type !== 'loading' && role === 'seal_photo' ? 'metadata_missing' : 'normal' })
    return finish(draft, 'Submitted evidence, metadata unavailable', 'Two phases cite a seal photo the artifact list did not return: each keeps its row ("Recorded artifact unavailable", "Time unavailable") instead of the submitted evidence silently disappearing.')
  },

  'photo-absent': anchorMs => {
    const draft = newDraft({ id: 'photo-absent', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'closed', through: 7, anchorMs, tailMin: 45 })
    walk(draft, { capture: (phase, role) => phase.phase_type === 'departure' && role === 'seal_photo' ? 'absent' : 'normal' })
    return finish(draft, 'Resolved phase, submitted photo missing', 'Departure completed with a seal number but no seal photo: the closed phase states "No seal photo submitted at completion" as a recorded fact.')
  },

  'phase-overridden': anchorMs => {
    const draft = newDraft({ id: 'phase-overridden', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 4, anchorMs, tailMin: 30 })
    walk(draft, { capture: phase => phase.phase_type === 'departure' ? 'absent' : 'normal' })
    const departure = phaseAt(draft, 3)
    const receipt = draft.trip.blockchain_receipts.find(item => item.id === departure.blockchain_receipt_id)
    if (receipt) receipt.receipt_type = 'phase_override'
    setPhase(draft, departure, {
      status: 'overridden', seal_number: null, pulsit_geofence_confirmed: null, action_location_assessment: null,
      driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null, driver_captured_at: null,
      dispatcher_override_user_id: OVERRIDE_USER_ID,
      dispatcher_override_note: 'Driver phone failed at the gate; seal confirmed by phone with the guard on duty.',
    })
    return finish(draft, 'Overridden phase', 'A dispatcher closed Departure for the driver: "Closed by dispatcher override", the note and who authorised it in plain view, and no check claims to have run.')
  },

  'anchor-pending': anchorMs => {
    const draft = newDraft({ id: 'anchor-pending', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 4, anchorMs, tailMin: 25 })
    walk(draft)
    unanchor(draft, phaseAt(draft, 2), 'pending')
    unanchor(draft, phaseAt(draft, 3), 'pending')
    return finish(draft, 'Anchor pending', 'Two phases are complete but their receipts are not on the chain yet: "Anchoring pending" appears in forensic mode only, and nothing about anchoring shows with it off.')
  },

  'anchor-failed': anchorMs => {
    const draft = newDraft({ id: 'anchor-failed', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 4, anchorMs, tailMin: 25 })
    walk(draft)
    unanchor(draft, phaseAt(draft, 3), 'failed')
    return finish(draft, 'Anchor failed', 'A completed phase whose anchor failed: the card carries "Anchor failed — receipt still owed" in every mode (never an unqualified success), and forensic mode adds the row.')
  },

  'signature-unattributed': anchorMs => {
    const draft = newDraft({ id: 'signature-unattributed', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'closed', through: 7, anchorMs, tailMin: 45 })
    walk(draft, { capture: (_phase, role) => role === 'pod_signature' ? 'unattributed' : 'normal' })
    return finish(draft, 'Unattributed signature', 'A confirmation image with no attribution from the server: the row says "Submitted as receiver confirmation" and never claims the receiver confirmed, because nothing proves who it came from.')
  },

  'fifteen-exceptions': anchorMs => {
    const draft = newDraft({ id: 'fifteen-exceptions', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 3, anchorMs, tailMin: 95 })
    walk(draft)
    const leg = phaseAt(draft, 4)
    const mix: ReadonlyArray<{ type: ExceptionType; severity: ExceptionSeverity; source: ExceptionSource; review: ExceptionReviewStatus; text: string }> = [
      { type: 'trailer_separated_in_transit', severity: 'critical', source: 'system', review: 'needs_review', text: 'The trailer tracker is 1.1 km from the horse tracker.' },
      { type: 'tracker_silent', severity: 'warning', source: 'system', review: 'needs_review', text: 'No position from the horse tracker for 9 minutes.' },
      { type: 'route_deviation', severity: 'warning', source: 'system', review: 'reviewed', text: 'Left the planned route for 4 km.' },
      { type: 'mechanical', severity: 'warning', source: 'driver', review: 'needs_review', text: 'Warning light on the dashboard; driver slowing.' },
      { type: 'checkpoint_timeout', severity: 'warning', source: 'system', review: 'recorded', text: 'Checkpoint window missed by 7 minutes.' },
      { type: 'cargo_damage', severity: 'warning', source: 'driver', review: 'needs_review', text: 'A strap has come loose; driver reports shifting load.' },
      { type: 'seal_broken_in_transit', severity: 'critical', source: 'driver', review: 'needs_review', text: 'Seal head found cracked at a fuel stop.' },
      { type: 'dispatcher_note', severity: 'info', source: 'dispatcher', review: 'reviewed', text: 'Called the driver; no concerns raised.' },
      { type: 'document_review', severity: 'info', source: 'driver', review: 'needs_review', text: 'Weighbridge slip photographed for review.' },
      { type: 'driver_location_mismatch', severity: 'warning', source: 'system', review: 'needs_review', text: "Driver's phone placed 300 m from the truck." },
      { type: 'gps_mismatch', severity: 'warning', source: 'system', review: 'recorded', text: 'Truck position disagrees with the last checkpoint.' },
      { type: 'escalation', severity: 'info', source: 'dispatcher', review: 'reviewed', text: 'Escalated to the duty manager for awareness.' },
      { type: 'tracker_silent', severity: 'info', source: 'system', review: 'needs_review', text: 'No position for 3 minutes.' },
      { type: 'route_deviation', severity: 'info', source: 'system', review: 'recorded', text: 'Brief deviation at a toll plaza.' },
      { type: 'mechanical', severity: 'info', source: 'driver', review: 'needs_review', text: 'Tyre pressure low; checked at the next stop.' },
    ]
    mix.forEach((item, index) => raise(draft, {
      key: `n${String(index + 1).padStart(2, '0')}`, phase: leg, type: item.type, severity: item.severity, source: item.source,
      description: item.text, review: item.review, atMs: anchorMs - minutes((mix.length - index) * EXCEPTION_GAP_MIN),
      outcome: 'no_action_required', note: item.review === 'reviewed' ? 'Looked at; nothing further needed.' : undefined,
    }))
    return finish(draft, 'A phase with 15 exceptions', 'Fifteen records on one leg: three rows show under the cap (unreviewed and worse first), "+12 more" opens the panel on the leg, and the page stays readable.')
  },

  'long-exception-description': anchorMs => {
    const draft = newDraft({ id: 'long-exception-description', route: SINGLE_ROUTE, cargo: SINGLE_CARGO, status: 'active', through: 3, anchorMs, tailMin: 80 })
    walk(draft)
    raise(draft, {
      key: 'long', phase: phaseAt(draft, 4), type: 'seal_broken_in_transit', severity: 'critical', source: 'driver',
      description: LONG_DESCRIPTION, atMs: anchorMs - minutes(30), gps: { lat: -28.38, lng: 29.38 },
    })
    return finish(draft, 'A 400-character exception description', 'The row clamps the description to two lines and the panel is where it is read in full; neither wraps badly or pushes the rail out of shape.')
  },

  'long-precinct-name': anchorMs => {
    const draft = newDraft({ id: 'long-precinct-name', route: [LONG_ORIGIN, LONG_DESTINATION], cargo: SINGLE_CARGO, status: 'active', through: 4, anchorMs, tailMin: 25 })
    walk(draft)
    return finish(draft, 'Long precinct names', 'Both ends have a very long precinct name: the phase header, the "Arrived" and "En route to" lines and the location details wrap without clipping.')
  },
}

/** All scenarios, in page order, built against one anchor time. */
export function buildScenarios(anchorMs: number = FIXTURE_ANCHOR_MS): TimelineScenario[] {
  return SCENARIO_IDS.map(id => BUILDERS[id](anchorMs))
}
