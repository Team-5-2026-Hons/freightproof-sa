import { describe, expect, it } from 'vitest'
import { CROSS_DOCK_PHASE_PLAN, SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ArtifactId, EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { ExceptionId, TripException } from '@shared/lib/types/exception'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import {
  RECEIVED_GAP_DISPLAY_MS,
  buildPhaseActs,
  exceptionEventTime,
  showsReceivedTime,
  type PhaseAct,
  type PhaseActsInput,
} from './acts'

// Single-leg sequence numbers: 3 departure, 4 in_transit, 5 arrival, 6 unloading, 7 confirmation.
const DEPARTURE = 3
const IN_TRANSIT = 4
const ARRIVAL = 5
const UNLOADING = 6
const CONFIRMATION = 7
// Cross-dock: leg 1 in_transit is 4, leg 2 departure is 8, leg 2 in_transit is 9.
const XD_DEPARTURE_1 = 3
const XD_IN_TRANSIT_1 = 4
const XD_DEPARTURE_2 = 8
const XD_IN_TRANSIT_2 = 9

const T = (hhmm: string): string => `2026-10-13T${hhmm}:00Z`

interface Scenario { phase: PhaseDescriptor; allPhases: PhaseDescriptor[] }

// Anchor defaults to not_required so tests that are not about anchoring do not have to
// account for an anchor act; the anchor tests set it explicitly.
function scenario(
  seq: number,
  overrides: Partial<PhaseDescriptor> = {},
  plan: readonly PhaseDescriptor[] = SINGLE_LEG_PHASE_PLAN,
  others: Record<number, Partial<PhaseDescriptor>> = {},
): Scenario {
  const allPhases = plan.map(p => {
    if (p.sequence_number === seq) return { ...p, anchor_status: 'not_required' as const, ...overrides }
    return { ...p, anchor_status: 'not_required' as const, ...others[p.sequence_number] }
  })
  return { phase: allPhases.find(p => p.sequence_number === seq)!, allPhases }
}

function artifact(id: string, overrides: Partial<EvidenceArtifactWithUrl> = {}): EvidenceArtifactWithUrl {
  return {
    id: id as ArtifactId,
    trip_id: 'trip-1',
    artifact_type: 'photo',
    s3_key: `k/${id}`,
    s3_bucket: 'evidence',
    file_hash: `hash-${id}`,
    mime_type: 'image/jpeg',
    captured_at: T('08:00'),
    captured_by_driver_id: 'driver-1',
    captured_by_user_id: null,
    captured_lat: null,
    captured_lng: null,
    created_at: T('08:00'),
    phase_event_id: null,
    evidence_role: null,
    signed_url: 'https://signed.example/x',
    ...overrides,
  }
}

function exception(id: string, phaseId: string | null, overrides: Partial<TripException> = {}): TripException {
  return {
    id: id as ExceptionId,
    trip_id: 'trip-1',
    exception_type: 'route_deviation',
    source: 'system',
    severity: 'warning',
    description: 'Off route',
    phase_event_id: phaseId,
    checkpoint_id: null,
    supporting_artifact_id: null,
    vehicle_id: null,
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
    created_at: T('09:00'),
    updated_at: T('09:00'),
    ...overrides,
  }
}

function receipt(overrides: Partial<BlockchainReceipt> = {}): BlockchainReceipt {
  return {
    id: 'receipt-1',
    subject_type: 'phase_event',
    subject_id: 'x',
    receipt_type: 'pickup',
    data_hash: 'h',
    hedera_topic_id: '0.0.1',
    hedera_sequence_number: 1,
    hedera_consensus_timestamp: null,
    hedera_tx_id: null,
    created_at: T('10:00'),
    ...overrides,
  }
}

function input(s: Scenario, overrides: Partial<PhaseActsInput> = {}): PhaseActsInput {
  return {
    phase: s.phase,
    allPhases: s.allPhases,
    isActive: false,
    tripStatus: 'active',
    tripClosedAt: null,
    artifacts: [],
    exceptions: [],
    receipt: undefined,
    ...overrides,
  }
}

const kinds = (acts: PhaseAct[]): string[] => acts.map(a => a.kind)
const evidenceRows = (acts: PhaseAct[]) => acts.filter(a => a.kind === 'evidence')

/** An artifact attributed to a scenario's phase. */
function attributed(s: Scenario, id: string, role: NonNullable<EvidenceArtifactWithUrl['evidence_role']>, overrides: Partial<EvidenceArtifactWithUrl> = {}): EvidenceArtifactWithUrl {
  return artifact(id, { phase_event_id: s.phase.phase_event_id, evidence_role: role, ...overrides })
}

describe('buildPhaseActs: normal completed departure', () => {
  it('returns the submitted seal photo then a completion row carrying the seal number', () => {
    const s = scenario(DEPARTURE, {
      status: 'completed', completed_at: T('09:00'), seal_number: 'AB-1234', seal_photo_artifact_id: 'seal-1',
    })
    const seal = attributed(s, 'seal-1', 'seal_photo', { captured_at: T('08:55'), created_at: T('08:56') })

    const acts = buildPhaseActs(input(s, { artifacts: [seal] }))

    expect(kinds(acts)).toEqual(['evidence', 'completion'])
    expect(acts[0]).toMatchObject({
      kind: 'evidence', role: 'seal_photo', artifactId: 'seal-1', state: 'submitted',
      provenance: 'driver', metadataAvailable: true, takenAt: T('08:55'), receivedAt: T('08:56'),
      receivedAfterCancellation: false,
    })
    expect(acts[1]).toMatchObject({
      kind: 'completion', outcome: 'completed', recordedAt: T('09:00'), override: null,
      values: { sealNumber: 'AB-1234', sealCondition: null, parcelsScanned: null, driverVisualCount: null },
    })
  })

  it('keeps keys unique within the result', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 'seal-1' })

    const acts = buildPhaseActs(input(s, { artifacts: [attributed(s, 'seal-1', 'seal_photo')] }))

    expect(new Set(acts.map(a => a.key)).size).toBe(acts.length)
  })
})

describe('buildPhaseActs: photo states never come from capture order (D24)', () => {
  it('shows two uploads for one role as uploaded while the phase is active', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })
    const first = attributed(s, 'seal-a', 'seal_photo', { captured_at: T('08:40'), created_at: T('08:41') })
    const second = attributed(s, 'seal-b', 'seal_photo', { captured_at: T('08:50'), created_at: T('08:51') })

    const rows = evidenceRows(buildPhaseActs(input(s, { isActive: true, artifacts: [first, second] })))

    expect(rows.map(r => r.kind === 'evidence' && r.state)).toEqual(['uploaded', 'uploaded'])
  })

  it('after completion marks the cited one submitted and the other not submitted, whichever was taken last', () => {
    const s = scenario(DEPARTURE, {
      status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 'seal-a',
    })
    const cited = attributed(s, 'seal-a', 'seal_photo', { captured_at: T('08:40'), created_at: T('08:41') })
    const later = attributed(s, 'seal-b', 'seal_photo', { captured_at: T('08:50'), created_at: T('08:51') })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [cited, later] })))
    const stateOf = (id: string) => rows.find(r => r.kind === 'evidence' && r.artifactId === id)

    expect(stateOf('seal-a')).toMatchObject({ state: 'submitted' })
    expect(stateOf('seal-b')).toMatchObject({ state: 'not_submitted' })
  })

  it('marks an upload received after completion as after_close', () => {
    const s = scenario(DEPARTURE, {
      status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 'seal-a',
    })
    const cited = attributed(s, 'seal-a', 'seal_photo', { created_at: T('08:41') })
    const late = attributed(s, 'seal-b', 'seal_photo', { created_at: T('09:30') })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [cited, late] })))

    expect(rows.find(r => r.kind === 'evidence' && r.artifactId === 'seal-b')).toMatchObject({ state: 'after_close' })
  })

  it('decides the state from the server clock, so a phone clock ahead of the server changes nothing', () => {
    // Taken 15:00 on a fast phone, stored at 14:41, phase closed 14:50: it reached the
    // server before the phase closed, whatever the phone says.
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('14:50') })
    const skewed = attributed(s, 'seal-skew', 'seal_photo', { captured_at: T('15:00'), created_at: T('14:41') })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [skewed] })))

    expect(rows[0]).toMatchObject({ state: 'not_submitted', takenAt: T('15:00'), receivedAt: T('14:41') })
  })

  it('keeps a stable order when the phone clock is ahead of the server', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })
    const a = attributed(s, 'a', 'seal_photo', { captured_at: T('15:00'), created_at: T('14:41') })
    const b = attributed(s, 'b', 'seal_photo', { captured_at: T('14:30'), created_at: T('14:42') })

    const first = buildPhaseActs(input(s, { isActive: true, artifacts: [a, b] }))
    const second = buildPhaseActs(input(s, { isActive: true, artifacts: [b, a] }))

    expect(first.map(x => x.key)).toEqual(second.map(x => x.key))
  })
})

describe('buildPhaseActs: overridden phase', () => {
  it('keeps uploads as not_submitted or after_close, records the override, and never emits absent rows', () => {
    const s = scenario(DEPARTURE, {
      status: 'overridden', completed_at: T('09:00'),
      dispatcher_override_note: 'Guard confirmed by phone', dispatcher_override_user_id: 'user-9',
    })
    const early = attributed(s, 'early', 'seal_photo', { created_at: T('08:50') })
    const late = attributed(s, 'late', 'seal_photo', { created_at: T('09:20') })

    const acts = buildPhaseActs(input(s, { artifacts: [early, late] }))

    expect(evidenceRows(acts).map(r => r.kind === 'evidence' && r.state)).toEqual(['not_submitted', 'after_close'])
    expect(acts.find(a => a.kind === 'completion')).toMatchObject({
      outcome: 'overridden', override: { note: 'Guard confirmed by phone', authorisedBy: 'user-9' },
    })
    expect(kinds(acts)).not.toContain('absent')
  })

  it('emits no absent rows for an overridden phase with no uploads at all', () => {
    const s = scenario(DEPARTURE, { status: 'overridden', completed_at: T('09:00'), dispatcher_override_note: 'n' })

    const acts = buildPhaseActs(input(s))

    expect(kinds(acts)).toEqual(['completion'])
  })

  it('reports an exception-status completion with outcome exception and no override', () => {
    const s = scenario(DEPARTURE, { status: 'exception', completed_at: T('09:00') })

    const completion = buildPhaseActs(input(s)).find(a => a.kind === 'completion')

    expect(completion).toMatchObject({ outcome: 'exception', override: null })
  })
})

describe('buildPhaseActs: cancelled trip (D23, D39)', () => {
  const cancelled = { tripStatus: 'cancelled' as const, tripClosedAt: T('10:00') }

  it('shows the unfinished phase uploads as trip_cancelled, flags the one received after cancellation, and has no expected rows', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })
    const before = attributed(s, 'before', 'seal_photo', { captured_at: T('09:58'), created_at: T('09:59') })
    const after = attributed(s, 'after', 'seal_photo', { captured_at: T('10:04'), created_at: T('10:05') })

    const acts = buildPhaseActs(input(s, { ...cancelled, artifacts: [before, after] }))

    expect(evidenceRows(acts).map(r => r.kind === 'evidence' && [r.state, r.receivedAfterCancellation])).toEqual([
      ['trip_cancelled', false], ['trip_cancelled', true],
    ])
    expect(kinds(acts)).not.toContain('expected')
  })

  it('returns nothing for a later pending phase with no uploads or exceptions', () => {
    const s = scenario(ARRIVAL, { status: 'pending' })

    expect(buildPhaseActs(input(s, { ...cancelled }))).toEqual([])
  })

  it('returns the milestone and both exceptions for an unresolved in_transit leg', () => {
    const s = scenario(IN_TRANSIT, { status: 'pending' }, SINGLE_LEG_PHASE_PLAN, {
      [DEPARTURE]: { status: 'completed', completed_at: T('08:00'), seal_number: 'AB-1' },
    })
    const e1 = exception('e1', s.phase.phase_event_id, { created_at: T('08:30') })
    const e2 = exception('e2', s.phase.phase_event_id, { created_at: T('09:10') })

    const acts = buildPhaseActs(input(s, { ...cancelled, exceptions: [e2, e1] }))

    expect(acts.map(a => a.kind)).toEqual(['milestone', 'exception', 'exception'])
    expect(acts.filter(a => a.kind === 'exception').map(a => a.kind === 'exception' && a.exceptionId)).toEqual(['e1', 'e2'])
  })

  it('shows rows for an unresolved phase that only has an exception', () => {
    const s = scenario(ARRIVAL, { status: 'pending' })
    const e = exception('e1', s.phase.phase_event_id)

    expect(kinds(buildPhaseActs(input(s, { ...cancelled, exceptions: [e] })))).toEqual(['exception'])
  })
})

describe('buildPhaseActs: visibility', () => {
  it('does not show an upload attributed to a future phase while it is pending', () => {
    const s = scenario(ARRIVAL, { status: 'pending' })
    const early = attributed(s, 'early', 'seal_photo')

    expect(buildPhaseActs(input(s, { isActive: false, artifacts: [early] }))).toEqual([])
  })

  it('returns nothing for an in_transit leg that has not started', () => {
    const s = scenario(IN_TRANSIT, { status: 'pending' })

    expect(buildPhaseActs(input(s, { isActive: false }))).toEqual([])
  })

  it('ignores artifacts and exceptions that belong to other phases', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00') })
    const other = scenario(ARRIVAL)
    const stray = attributed(other, 'stray', 'seal_photo')
    const strayException = exception('stray-e', other.phase.phase_event_id)

    const acts = buildPhaseActs(input(s, { artifacts: [stray], exceptions: [strayException] }))

    expect(kinds(acts)).toEqual(['absent', 'completion'])
  })
})

describe('buildPhaseActs: cited artifacts (D25)', () => {
  it('yields one row with unavailable metadata when the cited artifact is not in the list', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 'ghost' })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [] })))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      artifactId: 'ghost', role: 'seal_photo', state: 'submitted', metadataAvailable: false,
      takenAt: null, receivedAt: null, provenance: 'unknown',
    })
  })

  it('does not duplicate an artifact that is both attributed and cited', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 'seal-1' })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [attributed(s, 'seal-1', 'seal_photo')] })))

    expect(rows).toHaveLength(1)
  })

  it('shows a cited artifact that carries no attribution, using the column as its role', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 'old-app' })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [artifact('old-app')] })))

    expect(rows[0]).toMatchObject({ role: 'seal_photo', state: 'submitted', metadataAvailable: true })
  })
})

describe('buildPhaseActs: provenance (D8)', () => {
  it('marks an artifact attributed pod_signature for this phase as receiver', () => {
    const s = scenario(CONFIRMATION, { status: 'pending' })
    const sig = attributed(s, 'sig', 'pod_signature', { captured_by_driver_id: null })

    const rows = evidenceRows(buildPhaseActs(input(s, { isActive: true, artifacts: [sig] })))

    expect(rows[0]).toMatchObject({ provenance: 'receiver', role: 'pod_signature' })
  })

  it('marks an unattributed id cited as pod_signature with no driver id as unknown', () => {
    const s = scenario(CONFIRMATION, { status: 'completed', completed_at: T('11:00'), pod_signature_artifact_id: 'legacy' })
    const legacy = artifact('legacy', { captured_by_driver_id: null })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [legacy] })))

    expect(rows[0]).toMatchObject({ provenance: 'unknown', role: 'pod_signature', state: 'submitted' })
  })

  it('marks an artifact with a driver id as driver', () => {
    const s = scenario(CONFIRMATION, { status: 'pending' })
    const photo = attributed(s, 'pod', 'pod_photo', { captured_by_driver_id: 'driver-7' })

    const rows = evidenceRows(buildPhaseActs(input(s, { isActive: true, artifacts: [photo] })))

    expect(rows[0]).toMatchObject({ provenance: 'driver' })
  })

  it('does not treat a pod_signature attributed to a different phase as the receiver for this one', () => {
    const s = scenario(CONFIRMATION, { status: 'completed', completed_at: T('11:00'), pod_signature_artifact_id: 'sig' })
    const elsewhere = artifact('sig', { phase_event_id: 'another-phase', evidence_role: 'pod_signature', captured_by_driver_id: null })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [elsewhere] })))

    expect(rows[0]).toMatchObject({ provenance: 'unknown' })
  })
})

describe('buildPhaseActs: receiver and driver on confirmation', () => {
  it('returns the receiver row plus an expected driver_confirmation when the receiver confirms first', () => {
    const s = scenario(CONFIRMATION, { status: 'pending' })
    const sig = attributed(s, 'sig', 'pod_signature', { captured_by_driver_id: null })
    const pod = attributed(s, 'pod', 'pod_photo')

    const acts = buildPhaseActs(input(s, { isActive: true, artifacts: [sig, pod] }))

    expect(evidenceRows(acts)).toHaveLength(2)
    expect(acts.filter(a => a.kind === 'expected')).toEqual([
      expect.objectContaining({ role: null, reason: 'driver_confirmation' }),
    ])
  })
})

describe('buildPhaseActs: offline arrival', () => {
  it('orders the photo by capture, then the completion by its device time, and carries both clocks', () => {
    const s = scenario(ARRIVAL, {
      status: 'completed', completed_at: T('14:41'), driver_captured_at: T('14:18'),
      seal_number: 'AB-1', seal_condition: 'intact', seal_photo_artifact_id: 'seal-1',
    })
    const seal = attributed(s, 'seal-1', 'seal_photo', { captured_at: T('14:04'), created_at: T('14:41') })

    const acts = buildPhaseActs(input(s, { artifacts: [seal] }))

    expect(kinds(acts)).toEqual(['evidence', 'completion'])
    expect(acts[0]).toMatchObject({ takenAt: T('14:04'), receivedAt: T('14:41') })
    expect(acts[1]).toMatchObject({
      confirmedAt: T('14:18'), recordedAt: T('14:41'),
      values: { sealNumber: 'AB-1', sealCondition: 'intact' },
    })
  })

  it('has a null confirmedAt when the device time was not recorded', () => {
    const s = scenario(ARRIVAL, { status: 'completed', completed_at: T('14:41') })

    const completion = buildPhaseActs(input(s)).find(a => a.kind === 'completion')

    expect(completion).toMatchObject({ confirmedAt: null, recordedAt: T('14:41') })
  })
})

describe('showsReceivedTime (D16)', () => {
  it('is exported with a two-minute threshold', () => {
    expect(RECEIVED_GAP_DISPLAY_MS).toBe(120_000)
  })

  it('shows Received when the clocks are two minutes or more apart in either direction', () => {
    expect(showsReceivedTime(T('14:04'), T('14:41'))).toBe(true)
    expect(showsReceivedTime(T('14:41'), T('14:04'))).toBe(true)
    expect(showsReceivedTime(T('14:00'), T('14:02'))).toBe(true)
  })

  it('hides Received for ordinary upload latency and when either time is unknown', () => {
    expect(showsReceivedTime(T('14:00'), T('14:01'))).toBe(false)
    expect(showsReceivedTime(null, T('14:01'))).toBe(false)
    expect(showsReceivedTime(T('14:00'), null)).toBe(false)
  })
})

describe('buildPhaseActs: expected rows never assert absence (D15)', () => {
  it('lists every role of the phase and driver_confirmation on a fresh active departure, excluding waybill', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })

    const acts = buildPhaseActs(input(s, { isActive: true }))

    expect(acts).toEqual([
      expect.objectContaining({ kind: 'expected', role: 'seal_photo', reason: 'evidence' }),
      expect.objectContaining({ kind: 'expected', role: null, reason: 'driver_confirmation' }),
    ])
  })

  it('keeps the row expected when an unattributed upload exists, and has no missing state', () => {
    // An older driver app uploaded without attribution: the photo may well be on its way
    // to completion, so the row stays an expectation rather than turning into an absence.
    const s = scenario(DEPARTURE, { status: 'pending' })
    const unattributed = artifact('old-build')

    const acts = buildPhaseActs(input(s, { isActive: true, artifacts: [unattributed] }))

    expect(acts.find(a => a.kind === 'expected' && a.role === 'seal_photo')).toBeDefined()
    expect(kinds(acts)).not.toContain('absent')
  })

  it('drops the expected row for a role once it has an attributed upload', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })
    const seal = attributed(s, 'seal', 'seal_photo')

    const acts = buildPhaseActs(input(s, { isActive: true, artifacts: [seal] }))

    expect(kinds(acts)).toEqual(['evidence', 'expected'])
  })

  it('has no expected rows for a resolved phase, a non-active phase or a cancelled trip', () => {
    const done = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 's' })
    const pending = scenario(DEPARTURE, { status: 'pending' })

    expect(kinds(buildPhaseActs(input(done, { isActive: true })))).not.toContain('expected')
    expect(buildPhaseActs(input(pending, { isActive: false }))).toEqual([])
    expect(kinds(buildPhaseActs(input(pending, { isActive: true, tripStatus: 'cancelled' })))).not.toContain('expected')
  })

  it('shows no rows for a dormant trip that has not been activated', () => {
    const s = scenario(2, { status: 'pending' })

    expect(buildPhaseActs(input(s, { isActive: true, tripStatus: 'created' }))).toEqual([])
  })

  it('expects the receiver confirmation and POD photo on a fresh confirmation', () => {
    const s = scenario(CONFIRMATION, { status: 'pending' })

    const acts = buildPhaseActs(input(s, { isActive: true }))

    expect(acts.map(a => a.kind === 'expected' && a.role)).toEqual(['pod_photo', 'pod_signature', null])
  })
})

describe('buildPhaseActs: warehouse scan and exceptions in order', () => {
  it('expects the warehouse scan instead of the driver when the phase is blocked on it', () => {
    const s = scenario(2, { status: 'pending', blocked_on: 'warehouse_scan' })

    const acts = buildPhaseActs(input(s, { isActive: true }))

    expect(acts.filter(a => a.kind === 'expected').map(a => a.kind === 'expected' && a.reason)).toEqual([
      'evidence', 'warehouse_scan',
    ])
  })

  it('orders an exception among photos by its own event time', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })
    const early = attributed(s, 'early', 'seal_photo', { captured_at: T('08:50'), created_at: T('08:51') })
    const later = attributed(s, 'later', 'seal_photo', { captured_at: T('09:00'), created_at: T('09:01') })
    const e = exception('e1', s.phase.phase_event_id, { created_at: T('08:55') })

    const acts = buildPhaseActs(input(s, { isActive: true, artifacts: [later, early], exceptions: [e] }))

    expect(acts.filter(a => a.kind !== 'expected').map(a => a.kind === 'evidence' ? a.artifactId : a.key.split(':').pop())).toEqual([
      'early', 'e1', 'later',
    ])
  })

  it('places an exception by its supporting artifact capture time', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })
    const support = artifact('support', { captured_at: T('07:00') })
    const e = exception('e1', s.phase.phase_event_id, { created_at: T('09:00'), supporting_artifact_id: 'support' })
    const photo = attributed(s, 'photo', 'seal_photo', { captured_at: T('08:00') })

    const acts = buildPhaseActs(input(s, { isActive: true, artifacts: [photo, support], exceptions: [e] }))

    expect(acts[0]).toMatchObject({ kind: 'exception', at: T('07:00') })
  })

  it('sorts rows with an unknown time after rows with a known time, ties by key', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00'), seal_photo_artifact_id: 'ghost' })
    const known = attributed(s, 'known', 'seal_photo', { captured_at: T('08:00') })

    const rows = evidenceRows(buildPhaseActs(input(s, { artifacts: [known] })))

    expect(rows.map(r => r.kind === 'evidence' && r.artifactId)).toEqual(['known', 'ghost'])
  })
})

describe('exceptionEventTime', () => {
  it('uses the supporting artifact capture time when it is known', () => {
    const e = exception('e1', null, { supporting_artifact_id: 'a1', created_at: T('09:00') })
    const map = new Map([['a1', artifact('a1', { captured_at: T('08:10') })]])

    expect(exceptionEventTime(e, map)).toBe(T('08:10'))
  })

  it('falls back to created_at without a supporting artifact or when it did not load', () => {
    const plain = exception('e1', null, { created_at: T('09:00') })
    const dangling = exception('e2', null, { supporting_artifact_id: 'missing', created_at: T('09:05') })

    expect(exceptionEventTime(plain, new Map())).toBe(T('09:00'))
    expect(exceptionEventTime(dangling, new Map())).toBe(T('09:05'))
  })
})

describe('buildPhaseActs: in_transit', () => {
  const departedLeg = { [DEPARTURE]: { status: 'completed' as const, completed_at: T('08:00'), seal_number: 'AB-1' } }

  it('active: milestone, exceptions in time order, expected en_route then driver_confirmation, nothing else', () => {
    const s = scenario(IN_TRANSIT, { status: 'pending' }, SINGLE_LEG_PHASE_PLAN, departedLeg)
    const late = exception('late', s.phase.phase_event_id, { created_at: T('10:00') })
    const early = exception('early', s.phase.phase_event_id, { created_at: T('09:00') })

    const acts = buildPhaseActs(input(s, { isActive: true, exceptions: [late, early] }))

    expect(acts.map(a => a.kind)).toEqual(['milestone', 'exception', 'exception', 'expected', 'expected'])
    expect(acts[0]).toMatchObject({ kind: 'milestone', event: 'departed', at: T('08:00'), sealNumber: 'AB-1' })
    expect(acts.filter(a => a.kind === 'exception').map(a => a.kind === 'exception' && a.exceptionId)).toEqual(['early', 'late'])
    expect(acts.filter(a => a.kind === 'expected').map(a => a.kind === 'expected' && [a.reason, a.role])).toEqual([
      ['en_route', null], ['driver_confirmation', null],
    ])
  })

  it('active: omits the milestone while the leg departure time is unknown', () => {
    const s = scenario(IN_TRANSIT, { status: 'pending' })

    const acts = buildPhaseActs(input(s, { isActive: true }))

    expect(acts.map(a => a.kind)).toEqual(['expected', 'expected'])
  })

  it('resolved: milestone, exceptions, completion and anchor; no expected rows', () => {
    const s = scenario(IN_TRANSIT, { status: 'completed', completed_at: T('12:00'), anchor_status: 'anchored' }, SINGLE_LEG_PHASE_PLAN, departedLeg)
    const e = exception('e1', s.phase.phase_event_id, { created_at: T('09:00') })

    const acts = buildPhaseActs(input(s, { exceptions: [e], receipt: receipt({ hedera_consensus_timestamp: T('12:00') }) }))

    expect(acts.map(a => a.kind)).toEqual(['milestone', 'exception', 'completion', 'anchor'])
  })

  it('never produces absent or evidence rows', () => {
    const s = scenario(IN_TRANSIT, { status: 'completed', completed_at: T('12:00') }, SINGLE_LEG_PHASE_PLAN, departedLeg)

    expect(kinds(buildPhaseActs(input(s)))).not.toContain('absent')
  })

  it('gives each cross-dock leg its own departure time and seal, never the other leg\'s', () => {
    const plan = CROSS_DOCK_PHASE_PLAN
    const others = {
      [XD_DEPARTURE_1]: { status: 'completed' as const, completed_at: T('06:00'), seal_number: 'LEG-1' },
      [XD_DEPARTURE_2]: { status: 'completed' as const, completed_at: T('13:00'), seal_number: 'LEG-2' },
    }
    const leg1 = scenario(XD_IN_TRANSIT_1, { status: 'completed', completed_at: T('10:00') }, plan, others)
    const leg2 = scenario(XD_IN_TRANSIT_2, { status: 'pending' }, plan, others)

    const m1 = buildPhaseActs(input(leg1)).find(a => a.kind === 'milestone')
    const m2 = buildPhaseActs(input(leg2, { isActive: true })).find(a => a.kind === 'milestone')

    expect(m1).toMatchObject({ at: T('06:00'), sealNumber: 'LEG-1' })
    expect(m2).toMatchObject({ at: T('13:00'), sealNumber: 'LEG-2' })
  })

  it('gives leg 2 a milestone with a null seal when its own departure recorded none (D40)', () => {
    const others = {
      [XD_DEPARTURE_1]: { status: 'completed' as const, completed_at: T('06:00'), seal_number: 'LEG-1' },
      [XD_DEPARTURE_2]: { status: 'completed' as const, completed_at: T('13:00'), seal_number: null },
    }
    const leg2 = scenario(XD_IN_TRANSIT_2, { status: 'pending' }, CROSS_DOCK_PHASE_PLAN, others)

    const milestone = buildPhaseActs(input(leg2, { isActive: true })).find(a => a.kind === 'milestone')

    expect(milestone).toMatchObject({ at: T('13:00'), sealNumber: null })
  })
})

describe('buildPhaseActs: absent rows (D35, R4)', () => {
  it('emits one absent seal_photo for a resolved departure with no seal photo and no attributed upload', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00') })

    const acts = buildPhaseActs(input(s))

    expect(acts).toEqual([
      expect.objectContaining({ kind: 'absent', role: 'seal_photo' }),
      expect.objectContaining({ kind: 'completion' }),
    ])
  })

  it('never reports waybill_photo as absent', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00') })

    const absent = buildPhaseActs(input(s)).filter(a => a.kind === 'absent')

    expect(absent.map(a => a.kind === 'absent' && a.role)).toEqual(['seal_photo'])
  })

  it('emits no absent row when an upload is attributed to the role but not cited (it is a not_submitted row)', () => {
    const s = scenario(DEPARTURE, { status: 'completed', completed_at: T('09:00') })
    const stray = attributed(s, 'stray', 'seal_photo', { created_at: T('08:50') })

    const acts = buildPhaseActs(input(s, { artifacts: [stray] }))

    expect(kinds(acts)).toEqual(['evidence', 'completion'])
    expect(evidenceRows(acts)[0]).toMatchObject({ state: 'not_submitted' })
  })

  it('emits none for an active departure', () => {
    const s = scenario(DEPARTURE, { status: 'pending' })

    expect(kinds(buildPhaseActs(input(s, { isActive: true })))).not.toContain('absent')
  })

  it('emits none for a resolved unloading, activation or in_transit', () => {
    for (const seq of [UNLOADING, 1, IN_TRANSIT]) {
      const s = scenario(seq, { status: 'completed', completed_at: T('09:00') })

      expect(kinds(buildPhaseActs(input(s)))).not.toContain('absent')
    }
  })

  it('includes pod_signature for a resolved confirmation with no receiver confirmation (R4)', () => {
    const s = scenario(CONFIRMATION, {
      status: 'completed', completed_at: T('11:00'), pod_photo_artifact_id: 'pod',
    })
    const pod = attributed(s, 'pod', 'pod_photo')

    const acts = buildPhaseActs(input(s, { artifacts: [pod] }))

    expect(acts.filter(a => a.kind === 'absent').map(a => a.kind === 'absent' && a.role)).toEqual(['pod_signature'])
  })

  it('emits no pod_signature absence when an attributed receiver upload exists', () => {
    const s = scenario(CONFIRMATION, { status: 'completed', completed_at: T('11:00'), pod_photo_artifact_id: 'pod' })
    const sig = attributed(s, 'sig', 'pod_signature', { captured_by_driver_id: null, created_at: T('10:50') })
    const pod = attributed(s, 'pod', 'pod_photo')

    const acts = buildPhaseActs(input(s, { artifacts: [pod, sig] }))

    expect(kinds(acts)).not.toContain('absent')
  })

  it('sits immediately before the completion row, after earlier photos', () => {
    const s = scenario(CONFIRMATION, { status: 'completed', completed_at: T('11:00'), pod_photo_artifact_id: 'pod' })
    const pod = attributed(s, 'pod', 'pod_photo', { captured_at: T('10:30') })

    const acts = buildPhaseActs(input(s, { artifacts: [pod] }))

    expect(kinds(acts)).toEqual(['evidence', 'absent', 'completion'])
  })
})

describe('buildPhaseActs: anchor row', () => {
  const done = { status: 'completed' as const, completed_at: T('09:00') }

  it('reports pending with no consensus time', () => {
    const s = scenario(1, { ...done, anchor_status: 'pending' })

    const anchor = buildPhaseActs(input(s)).find(a => a.kind === 'anchor')

    expect(anchor).toMatchObject({ status: 'pending', consensusAt: null })
  })

  it('reports anchored with the receipt consensus time, after the completion row', () => {
    const s = scenario(1, { ...done, anchor_status: 'anchored' })

    const acts = buildPhaseActs(input(s, { receipt: receipt({ hedera_consensus_timestamp: T('09:01') }) }))

    expect(kinds(acts)).toEqual(['completion', 'anchor'])
    expect(acts[1]).toMatchObject({ status: 'anchored', consensusAt: T('09:01') })
  })

  it('reports failed', () => {
    const s = scenario(1, { ...done, anchor_status: 'failed' })

    expect(buildPhaseActs(input(s)).find(a => a.kind === 'anchor')).toMatchObject({ status: 'failed', consensusAt: null })
  })

  it('produces no anchor act when anchoring is not required', () => {
    const s = scenario(1, { ...done, anchor_status: 'not_required' })

    expect(kinds(buildPhaseActs(input(s)))).not.toContain('anchor')
  })

  it('produces no anchor act while the phase is still unresolved: nothing is owed yet', () => {
    const s = scenario(DEPARTURE, { status: 'pending', anchor_status: 'pending' })

    expect(kinds(buildPhaseActs(input(s, { isActive: true })))).not.toContain('anchor')
  })
})

describe('buildPhaseActs: completion values', () => {
  it('reads the scanned count from the loading row and the blind count from the row', () => {
    const s = scenario(2, { status: 'completed', completed_at: T('07:00'), parcel_count_origin: 38, driver_visual_count: 37 })

    const completion = buildPhaseActs(input(s)).find(a => a.kind === 'completion')

    expect(completion).toMatchObject({ values: { parcelsScanned: 38, driverVisualCount: 37 } })
  })

  it('reads the scanned count from the destination count on a confirmation, never on unloading', () => {
    const confirmation = scenario(CONFIRMATION, {
      status: 'completed', completed_at: T('11:00'), parcel_count_destination: 36, parcel_count_origin: null,
    })
    const unloading = scenario(UNLOADING, { status: 'completed', completed_at: T('10:00'), parcel_count_destination: 99 })

    const c = buildPhaseActs(input(confirmation)).find(a => a.kind === 'completion')
    const u = buildPhaseActs(input(unloading)).find(a => a.kind === 'completion')

    expect(c).toMatchObject({ values: { parcelsScanned: 36 } })
    expect(u).toMatchObject({ values: { parcelsScanned: null } })
  })

  it('gives an override with only a note a null authorisedBy', () => {
    const s = scenario(DEPARTURE, { status: 'overridden', completed_at: T('09:00'), dispatcher_override_note: 'Phoned' })

    expect(buildPhaseActs(input(s)).find(a => a.kind === 'completion')).toMatchObject({
      override: { note: 'Phoned', authorisedBy: null },
    })
  })
})
