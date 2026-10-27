// The pure row model behind the dispatcher's per-phase "Recorded" rail: what the ledger,
// the evidence artifacts and the exceptions say happened in ONE phase, in order.
// Pure on purpose (no React, fetch or clock): the page already loads every input, and a
// future child-event ledger would replace this single seam (D10).
//
// Nothing here infers which photo "won" from capture order. The phone clock can be wrong,
// so state comes from the phase's own columns (what was submitted) and the SERVER's
// `created_at` against `completed_at` (D24, D27). Expected rows are expectations, never
// claims of absence (D15); only a resolved phase may report an `absent` row (D35).

import type { PhaseDescriptor, SealCondition } from '@shared/lib/types/phase'
import type { TripStatus } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import type { EvidenceArtifactWithUrl, EvidenceRole } from '@shared/lib/types/evidence'
import { EVIDENCE_ROLES, EVIDENCE_ROLE_FIELD } from '@shared/lib/constants/phase-meta'
import { departureSealForLeg, isResolved, legDepartureAt } from './derive'
import { tripEventKey, tripEventTime, type TripTimelineEvent } from './trip-events'

export type EvidenceActState = 'uploaded' | 'submitted' | 'not_submitted' | 'after_close' | 'trip_cancelled'
export type EvidenceProvenance = 'driver' | 'receiver' | 'unknown'

export interface CompletionValues {
  sealNumber: string | null
  sealCondition: SealCondition | null
  parcelsScanned: number | null
  driverVisualCount: number | null
}

export interface EvidenceAct {
  kind: 'evidence'; key: string; role: EvidenceRole; artifactId: string
  provenance: EvidenceProvenance; state: EvidenceActState
  metadataAvailable: boolean; takenAt: string | null; receivedAt: string | null
  receivedAfterCancellation: boolean
}
/** in_transit only. */
export interface MilestoneAct { kind: 'milestone'; key: string; event: 'departed'; at: string; sealNumber: string | null }
export interface CompletionAct {
  kind: 'completion'; key: string; outcome: 'completed' | 'exception' | 'overridden'
  confirmedAt: string | null; recordedAt: string; values: CompletionValues
  override: { note: string | null; authorisedBy: string | null } | null
}
export interface ExceptionAct { kind: 'exception'; key: string; exceptionId: string; at: string; trigger: 'handshake' | 'override' | 'event' }

const HANDSHAKE_FINDING_TYPES: readonly TripException['exception_type'][] = [
  'driver_vehicle_separation', 'driver_location_mismatch', 'gps_mismatch', 'trailer_location_mismatch',
  'seal_mismatch', 'seal_unverified', 'seal_compromised', 'parcel_count_mismatch',
]

export function exceptionTrigger(exception: TripException, phase: PhaseDescriptor): ExceptionAct['trigger'] {
  if (!phase.completed_at || exception.source !== 'system' || exception.checkpoint_id !== null
    || exception.phase_event_id !== phase.phase_event_id || !HANDSHAKE_FINDING_TYPES.includes(exception.exception_type)) return 'event'
  return phase.status === 'overridden' ? 'override' : 'handshake'
}
/** Resolved phases only (D35). */
export interface AbsentAct { kind: 'absent'; key: string; role: EvidenceRole }
/** Produced for every phase that owes a receipt; the component shows it in forensic mode only (D32). */
export interface AnchorAct { kind: 'anchor'; key: string; status: 'pending' | 'anchored' | 'failed'; consensusAt: string | null }
export interface ExpectedAct {
  kind: 'expected'; key: string; role: EvidenceRole | null
  reason: 'evidence' | 'driver_confirmation' | 'warehouse_scan' | 'en_route'
}

/** in_transit only: an incident or a driver transfer that happened during the leg (placed by
 *  positionTripEvents). A record of the trip, not of the phase, so the ledger builders never make
 *  one; withTripEventActs merges them in. */
export interface TripEventAct { kind: 'trip_event'; key: string; at: string; event: TripTimelineEvent }

export type PhaseAct = EvidenceAct | MilestoneAct | CompletionAct | ExceptionAct | AbsentAct | AnchorAct | ExpectedAct | TripEventAct

const DOCUMENT_ROLES: ReadonlySet<EvidenceRole> = new Set<EvidenceRole>(['pod_signature', 'linehaul_pdf'])

/** True when this role's evidence is shown as a document (and counted as files), not a photo. */
export function isDocumentRole(role: EvidenceRole): boolean {
  return DOCUMENT_ROLES.has(role)
}

export interface PhaseActsInput {
  phase: PhaseDescriptor
  allPhases: readonly PhaseDescriptor[]
  isActive: boolean
  tripStatus: TripStatus
  tripClosedAt: string | null
  artifacts: readonly EvidenceArtifactWithUrl[]
  exceptions: readonly TripException[]
  receipt: BlockchainReceipt | undefined
}

export const RECEIVED_GAP_DISPLAY_MS = 120_000

const UNTRACKED_ROLES: ReadonlySet<EvidenceRole> = new Set<EvidenceRole>(['waybill_photo', 'linehaul_pdf'])
const WAREHOUSE_SCAN_BLOCK = 'warehouse_scan'
const ALL_ROLES = Object.keys(EVIDENCE_ROLE_FIELD) as EvidenceRole[]

/** Chronological anchor for an exception: the instant its own evidence was captured, when
 *  it has an artifact carrying one, rather than the millisecond the system persisted the
 *  row; the recorded time for an exception with no artifact. TripException carries no
 *  capture timestamp of its own, so this is the only place that time can come from. */
export function exceptionEventTime(exception: TripException, artifactsById: ReadonlyMap<string, EvidenceArtifactWithUrl>): string {
  const artifact = exception.supporting_artifact_id ? artifactsById.get(exception.supporting_artifact_id) : undefined
  return artifact?.captured_at ?? exception.created_at
}

/** Whether a row should label a "Received" clock next to "Taken" (D16). Unknown times
 *  never qualify: there is nothing honest to compare. */
export function showsReceivedTime(takenAt: string | null, receivedAt: string | null): boolean {
  const taken = toMillis(takenAt)
  const received = toMillis(receivedAt)
  return taken !== null && received !== null && Math.abs(received - taken) >= RECEIVED_GAP_DISPLAY_MS
}

function toMillis(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** True only when both are known and `later` is strictly after `earlier`. */
function isAfter(later: string | null | undefined, earlier: string | null | undefined): boolean {
  const a = toMillis(later)
  const b = toMillis(earlier)
  return a !== null && b !== null && a > b
}

interface Ctx {
  phase: PhaseDescriptor
  allPhases: readonly PhaseDescriptor[]
  resolved: boolean
  running: boolean
  isActive: boolean
  tripStatus: TripStatus
  tripClosedAt: string | null
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  cited: Map<string, EvidenceRole>
  attributed: EvidenceArtifactWithUrl[]
  exceptions: TripException[]
  receipt: BlockchainReceipt | undefined
}

function roleColumn(phase: PhaseDescriptor, role: EvidenceRole): string | null {
  return phase[EVIDENCE_ROLE_FIELD[role]] ?? null
}

function buildContext(input: PhaseActsInput): Ctx {
  const { phase } = input
  const cited = new Map<string, EvidenceRole>()
  for (const role of ALL_ROLES) {
    const id = roleColumn(phase, role)
    if (id) cited.set(id, role)
  }
  const attributed = input.artifacts.filter(a => a.phase_event_id === phase.phase_event_id && a.evidence_role !== null)
  const exceptionsById = new Map<string, TripException>()
  for (const exception of input.exceptions) {
    if (exception.phase_event_id === phase.phase_event_id) exceptionsById.set(exception.id, exception)
  }
  return {
    phase,
    allPhases: input.allPhases,
    resolved: isResolved(phase),
    running: input.tripStatus !== 'created' && input.tripStatus !== 'closed' && input.tripStatus !== 'cancelled',
    isActive: input.isActive,
    tripStatus: input.tripStatus,
    tripClosedAt: input.tripClosedAt,
    artifactsById: new Map(input.artifacts.map(a => [a.id, a])),
    cited,
    attributed,
    exceptions: [...exceptionsById.values()],
    receipt: input.receipt,
  }
}

/** D23, D39: a resolved phase always shows its rows; an unresolved one only while it is
 *  the live phase of a running trip, or, on a cancelled trip, when it holds something the
 *  dispatcher would otherwise lose (an upload or an exception). */
function rowsAreVisible(ctx: Ctx): boolean {
  if (ctx.resolved) return true
  if (ctx.isActive && ctx.running) return true
  return ctx.tripStatus === 'cancelled' && (ctx.attributed.length > 0 || ctx.exceptions.length > 0)
}

function evidenceState(ctx: Ctx, id: string, artifact: EvidenceArtifactWithUrl | undefined): EvidenceActState {
  if (ctx.resolved) {
    if (ctx.cited.has(id)) return 'submitted'
    return isAfter(artifact?.created_at, ctx.phase.completed_at) ? 'after_close' : 'not_submitted'
  }
  return ctx.tripStatus === 'cancelled' ? 'trip_cancelled' : 'uploaded'
}

/** D8: only the receiver route can attribute a `pod_signature` to a phase, so that
 *  attribution (and nothing else) is what makes it the receiver's. */
function evidenceProvenance(ctx: Ctx, artifact: EvidenceArtifactWithUrl | undefined): EvidenceProvenance {
  if (!artifact) return 'unknown'
  if (artifact.evidence_role === 'pod_signature' && artifact.phase_event_id === ctx.phase.phase_event_id) return 'receiver'
  return artifact.captured_by_driver_id ? 'driver' : 'unknown'
}

function evidenceActFor(ctx: Ctx, id: string): EvidenceAct | null {
  const artifact = ctx.artifactsById.get(id)
  const role = ctx.cited.get(id) ?? artifact?.evidence_role ?? null
  if (role === null) return null
  const state = evidenceState(ctx, id, artifact)
  return {
    kind: 'evidence',
    key: `${ctx.phase.phase_event_id}:evidence:${id}`,
    role,
    artifactId: id,
    provenance: evidenceProvenance(ctx, artifact),
    state,
    metadataAvailable: artifact !== undefined,
    takenAt: artifact?.captured_at ?? null,
    receivedAt: artifact?.created_at ?? null,
    receivedAfterCancellation: state === 'trip_cancelled' && isAfter(artifact?.created_at, ctx.tripClosedAt),
  }
}

function evidenceActs(ctx: Ctx): EvidenceAct[] {
  const ids = new Set<string>([...ctx.attributed.map(a => a.id), ...ctx.cited.keys()])
  const acts: EvidenceAct[] = []
  for (const id of ids) {
    const act = evidenceActFor(ctx, id)
    if (act) acts.push(act)
  }
  return acts
}

function milestoneActs(ctx: Ctx): MilestoneAct[] {
  if (ctx.phase.phase_type !== 'in_transit') return []
  const at = legDepartureAt(ctx.allPhases, ctx.phase)
  if (at === null) return []
  return [{
    kind: 'milestone',
    key: `${ctx.phase.phase_event_id}:milestone:departed`,
    event: 'departed',
    at,
    sealNumber: departureSealForLeg(ctx.allPhases, ctx.phase),
  }]
}

/** Each count is read from the row the backend writes it on: loading stamps the origin
 *  tally, confirmation stamps the destination tally, and unloading carries neither (its
 *  count is live from the parcels), so reading it there would show a permanent null. */
function parcelsScanned(phase: PhaseDescriptor): number | null {
  if (phase.phase_type === 'loading') return phase.parcel_count_origin
  if (phase.phase_type === 'confirmation') return phase.parcel_count_destination
  return null
}

function completionOutcome(phase: PhaseDescriptor): CompletionAct['outcome'] {
  if (phase.status === 'overridden') return 'overridden'
  return phase.status === 'exception' ? 'exception' : 'completed'
}

function completionActs(ctx: Ctx): CompletionAct[] {
  const { phase } = ctx
  if (phase.completed_at === null) return []
  const hasOverride = phase.dispatcher_override_note !== null || phase.dispatcher_override_user_id !== null
  return [{
    kind: 'completion',
    key: `${phase.phase_event_id}:completion`,
    outcome: completionOutcome(phase),
    confirmedAt: phase.driver_captured_at ?? null,
    recordedAt: phase.completed_at,
    values: {
      sealNumber: phase.seal_number,
      sealCondition: phase.seal_condition ?? null,
      parcelsScanned: parcelsScanned(phase),
      driverVisualCount: phase.driver_visual_count,
    },
    override: hasOverride
      ? { note: phase.dispatcher_override_note, authorisedBy: phase.dispatcher_override_user_id }
      : null,
  }]
}

function toExceptionActs(
  phase: PhaseDescriptor, exceptions: readonly TripException[], artifactsById: ReadonlyMap<string, EvidenceArtifactWithUrl>,
): ExceptionAct[] {
  return exceptions.map(exception => ({
    kind: 'exception',
    key: `${phase.phase_event_id}:exception:${exception.id}`,
    exceptionId: exception.id,
    at: exceptionEventTime(exception, artifactsById),
    trigger: exceptionTrigger(exception, phase),
  }))
}

function exceptionActs(ctx: Ctx): ExceptionAct[] {
  return toExceptionActs(ctx.phase, ctx.exceptions, ctx.artifactsById)
}

/** A phase's exceptions as acts in time order, for a card that has no other acts (trip creation). */
export function buildExceptionActs(
  phase: PhaseDescriptor, exceptions: readonly TripException[], artifactsById: ReadonlyMap<string, EvidenceArtifactWithUrl>,
): ExceptionAct[] {
  return toExceptionActs(phase, exceptions, artifactsById).sort(compareByEventTime)
}

function hasAttributedUpload(ctx: Ctx, role: EvidenceRole): boolean {
  return ctx.attributed.some(a => a.evidence_role === role)
}

/** Roles a phase of this type is expected to evidence, and nothing yet records. */
function unevidencedRoles(ctx: Ctx): EvidenceRole[] {
  return EVIDENCE_ROLES[ctx.phase.phase_type].filter(role =>
    !UNTRACKED_ROLES.has(role) && roleColumn(ctx.phase, role) === null && !hasAttributedUpload(ctx, role))
}

/** D35: on a closed, non-overridden phase a role with no submitted copy and no upload is a
 *  recorded fact. An override bypasses the checks, so it never claims one. */
function absentActs(ctx: Ctx): AbsentAct[] {
  if (!ctx.resolved || ctx.phase.status === 'overridden') return []
  return unevidencedRoles(ctx).map(role => ({
    kind: 'absent',
    key: `${ctx.phase.phase_event_id}:absent:${role}`,
    role,
  }))
}

/** Nothing is owed until the phase resolves: a fresh row carries `pending` from the moment
 *  the plan is written, which would otherwise read as "Anchoring pending" on every phase
 *  that has not even started. */
function anchorActs(ctx: Ctx): AnchorAct[] {
  const { phase } = ctx
  if (!ctx.resolved || phase.anchor_status === 'not_required') return []
  return [{
    kind: 'anchor',
    key: `${phase.phase_event_id}:anchor`,
    status: phase.anchor_status,
    consensusAt: ctx.receipt?.hedera_consensus_timestamp ?? null,
  }]
}

function expectedAct(ctx: Ctx, role: EvidenceRole | null, reason: ExpectedAct['reason']): ExpectedAct {
  return { kind: 'expected', key: `${ctx.phase.phase_event_id}:expected:${role ?? reason}`, role, reason }
}

/** What the live phase is still waiting for (D15): an expectation, never a claim that
 *  something is missing, because an older driver app may have uploaded unattributed. */
function expectedActs(ctx: Ctx): ExpectedAct[] {
  if (!ctx.isActive || !ctx.running || ctx.resolved) return []
  if (ctx.phase.phase_type === 'in_transit') {
    return [expectedAct(ctx, null, 'en_route'), expectedAct(ctx, null, 'driver_confirmation')]
  }
  const evidence = unevidencedRoles(ctx).map(role => expectedAct(ctx, role, 'evidence'))
  const waiting = ctx.phase.blocked_on === WAREHOUSE_SCAN_BLOCK ? 'warehouse_scan' : 'driver_confirmation'
  return [...evidence, expectedAct(ctx, null, waiting)]
}

function eventTime(act: PhaseAct): number | null {
  switch (act.kind) {
    case 'evidence': return toMillis(act.takenAt)
    case 'milestone': return toMillis(act.at)
    case 'completion': return toMillis(act.confirmedAt ?? act.recordedAt)
    case 'exception': return toMillis(act.at)
    case 'trip_event': return toMillis(act.at)
    default: return null
  }
}

/** Event time ascending, unknown times after known ones, ties by key so the order is
 *  stable whatever order the inputs arrived in. */
function compareByEventTime(a: PhaseAct, b: PhaseAct): number {
  const ta = eventTime(a)
  const tb = eventTime(b)
  if (ta !== null && tb !== null && ta !== tb) return ta - tb
  if (ta !== null && tb === null) return -1
  if (ta === null && tb !== null) return 1
  return a.key.localeCompare(b.key)
}

/** Absent rows state what the completion found, so they sit immediately before it. */
function insertBeforeCompletion(timed: PhaseAct[], absent: AbsentAct[]): PhaseAct[] {
  const index = timed.findIndex(act => act.kind === 'completion')
  if (index === -1) return [...timed, ...absent]
  return [...timed.slice(0, index), ...absent, ...timed.slice(index)]
}

export function buildPhaseActs(input: PhaseActsInput): PhaseAct[] {
  const ctx = buildContext(input)
  if (!rowsAreVisible(ctx)) return []

  const allTimed = [
    ...evidenceActs(ctx), ...milestoneActs(ctx), ...completionActs(ctx), ...exceptionActs(ctx),
  ].sort(compareByEventTime)
  const attached = allTimed.filter((act): act is ExceptionAct => act.kind === 'exception' && act.trigger !== 'event')
  const timed = allTimed.filter(act => act.kind !== 'exception' || act.trigger === 'event')
    .flatMap<PhaseAct>(act => act.kind === 'completion' ? [act, ...attached] : [act])

  return [
    ...insertBeforeCompletion(timed, absentActs(ctx)),
    ...anchorActs(ctx),
    ...expectedActs(ctx),
  ]
}

const TAIL_KINDS: ReadonlySet<PhaseAct['kind']> = new Set<PhaseAct['kind']>(['absent', 'anchor', 'expected'])

/** Merges the leg's incidents and transfers into a card's rows by time, so "Departed", a panic,
 *  the hijacking and "Reached" read as one chronology. Each goes before the first row that is
 *  later than it, or before the tail rows. Confirmation findings are skipped: they belong to the
 *  completion and are drawn under it. Expects `events` in time order (positionTripEvents). */
export function withTripEventActs(acts: readonly PhaseAct[], events: readonly TripTimelineEvent[]): PhaseAct[] {
  const merged = [...acts]
  for (const event of events) {
    const act: TripEventAct = { kind: 'trip_event', key: `trip-event:${tripEventKey(event)}`, at: tripEventTime(event), event }
    const at = toMillis(act.at) ?? Number.POSITIVE_INFINITY
    const index = merged.findIndex(other => TAIL_KINDS.has(other.kind)
      || (!(other.kind === 'exception' && other.trigger !== 'event') && (eventTime(other) ?? Number.NEGATIVE_INFINITY) > at))
    merged.splice(index === -1 ? merged.length : index, 0, act)
  }
  return merged
}
