// One phase card's derived model: the rows, the checks, the verdict and which zones it has.
// Pure (the clock arrives as `nowMs`) so vitest can prove it.
//
// This is where the seam between Task 8's builders and the UI lives. Two rules need trip
// context that the builders cannot see, so they are applied here rather than left to the
// component:
//  - An unresolved phase on a cancelled trip must not show a live scan line or the in_transit
//    "seal not inspected" line (buildPhaseChecks has no trip status).
//  - Only the live phase of a running trip awaits checks; everything else either has them or
//    has no Checked zone at all (D34, design note §7.1).

import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Trip } from '@shared/lib/types/trip'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'
import { buildExceptionActs, buildPhaseActs, withTripEventActs, type PhaseAct } from './acts'
import { tripEventReasons, type TripTimelineEvent } from './trip-events'
import { buildPhaseChecks, type PhaseCheck } from './checks'
import { phaseVerdict, type PhaseVerdict } from './verdict'
import { isResolved, legDepartureAt, originScannedCount } from './derive'
import { countAtStop, currentTripPhase, precinctAtPhase } from './trip-detail'

export type CheckedZone = 'checks' | 'awaiting' | 'none'

export interface PhaseCardInput {
  trip: Trip
  phase: PhaseDescriptor
  precincts: Precinct[]
  artifacts: readonly EvidenceArtifactWithUrl[]
  exceptions: readonly TripException[]
  receipt: BlockchainReceipt | undefined
  nowMs: number
  tripEvents?: readonly TripTimelineEvent[]
}

export interface PhaseCardModel {
  isActive: boolean
  running: boolean
  acts: PhaseAct[]
  checks: PhaseCheck[]
  checkedZone: CheckedZone
  verdict: PhaseVerdict | null
  hasBody: boolean
}

const EMPTY_MODEL: PhaseCardModel = {
  isActive: false, running: false, acts: [], checks: [], checkedZone: 'none', verdict: null, hasBody: true,
}

function isRunning(trip: Trip): boolean {
  return trip.status !== 'created' && trip.status !== 'closed' && trip.status !== 'cancelled'
}

function checkedZoneFor(phase: PhaseDescriptor, resolved: boolean, live: boolean): CheckedZone {
  if (phase.phase_type === 'in_transit') return resolved || live ? 'checks' : 'none'
  if (resolved) return 'checks'
  return live ? 'awaiting' : 'none'
}

function checksFor(input: PhaseCardInput, resolved: boolean): PhaseCheck[] {
  const { trip, phase, precincts } = input
  if (trip.status === 'cancelled' && !resolved) return []
  const isLoading = phase.phase_type === 'loading'
  const isUnloading = phase.phase_type === 'unloading'
  return buildPhaseChecks({
    phase,
    allPhases: trip.phases,
    expectedCount: isLoading ? countAtStop(trip, phase, 'out', 'expected') : isUnloading ? countAtStop(trip, phase, 'in', 'expected') : null,
    liveScannedCount: isLoading ? countAtStop(trip, phase, 'out', 'scanned') : isUnloading ? countAtStop(trip, phase, 'in', 'scanned') : null,
    originScannedCount: originScannedCount(trip.phases),
    precinct: precinctAtPhase(trip, phase, precincts),
  })
}

function legOf(trip: Trip, phase: PhaseDescriptor): { departedAt: string | null; arrivedAt: string | null } | null {
  if (phase.phase_type !== 'in_transit') return null
  return { departedAt: legDepartureAt(trip.phases, phase), arrivedAt: phase.completed_at }
}

export function buildPhaseCardModel(input: PhaseCardInput): PhaseCardModel {
  const { trip, phase, exceptions, receipt, nowMs } = input
  if (phase.phase_type === 'trip_creation') {
    const byId = new Map(input.artifacts.map(artifact => [artifact.id as string, artifact]))
    return { ...EMPTY_MODEL, acts: buildExceptionActs(phase, exceptions, byId) }
  }

  const resolved = isResolved(phase)
  const running = isRunning(trip)
  const isActive = currentTripPhase(trip)?.phase_event_id === phase.phase_event_id
  const live = isActive && running

  const tripEvents = input.tripEvents ?? []
  const acts = withTripEventActs(buildPhaseActs({
    phase, allPhases: trip.phases, isActive, tripStatus: trip.status, tripClosedAt: trip.closed_at,
    artifacts: input.artifacts, exceptions, receipt,
  }), tripEvents)
  const checks = checksFor(input, resolved)
  const uploads = acts.filter(act => act.kind === 'evidence' && act.state === 'uploaded').length
  const baseVerdict = phaseVerdict({
    phase, checks, exceptions, actCounts: { uploads }, isActive, tripStatus: trip.status, leg: legOf(trip, phase), nowMs,
  })
  const eventReasons = tripEventReasons(tripEvents)
  const verdict = baseVerdict && eventReasons.length > 0 ? { ...baseVerdict, reasons: [...eventReasons, ...baseVerdict.reasons] } : baseVerdict

  return {
    isActive,
    running,
    acts,
    checks,
    checkedZone: checkedZoneFor(phase, resolved, live),
    verdict,
    hasBody: resolved || live || acts.length > 0,
  }
}
