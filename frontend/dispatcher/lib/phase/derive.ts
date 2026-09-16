// The dispatcher's single source of "where is this trip, and what has it evidenced".
// Mirrors the backend's derivation (orchestration/phase_service.py: _is_resolved,
// recompute_position) — on divergence, the backend wins and this is the bug.
// Deliberately pure (no React/fetch/clock) so vitest can prove it.
// LENGTH IS DATA: nothing here may assume 6 phases or sequence 0..6.

import type { CoarseTripStatus, PhaseDescriptor, PhaseEventId, PhaseStatus, PhaseType } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { TRIP_STATUS_META, type StatusMeta } from '@shared/lib/constants/status-meta'

/** How a phase renders in the timeline and in the chain. `active` and `next` both mean
 *  "the ledger is waiting here"; `active` is real work started, currently unreachable
 *  since the backend never writes `in_progress` (phases go pending -> completed). */
export type PhaseNodeType = 'done' | 'active' | 'next' | 'warn' | 'pending'

/** One node in a PhaseChain, normalised so both the trip list (counts only) and any
 *  plan-holding caller can feed the same component. */
export interface PhaseChainNode {
  key: string
  status: PhaseStatus
  label: string
}

// Mirrors phase_service._is_resolved exactly: a phase the ledger will never revisit.
// `exception` IS resolved — the trip still departs/unloads/closes past it, the anomaly
// just stays recorded on the row. Rendering it visually distinct is nodeTypeFor's job.
const RESOLVED: readonly PhaseStatus[] = ['completed', 'exception', 'overridden']

export function isResolved(phase: PhaseDescriptor): boolean {
  return RESOLVED.includes(phase.status)
}

/** Plan order. Never trust the array order off the wire. */
export function sortedPlan(phases: readonly PhaseDescriptor[]): PhaseDescriptor[] {
  return [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
}

/** The lowest-sequence unresolved phase — the same derivation recompute_position
 *  runs server-side. Null on a closed trip. */
export function activePhase(phases: readonly PhaseDescriptor[]): PhaseDescriptor | null {
  return sortedPlan(phases).find(phase => !isResolved(phase)) ?? null
}

export function nodeTypeFor(
  phase: PhaseDescriptor,
  activePhaseEventId: PhaseEventId | null,
  tripStatus?: CoarseTripStatus | null,
): PhaseNodeType {
  // Must run before isResolved: exception is a resolved status but still an anomaly for display.
  if (phase.status === 'exception') return 'warn'
  if (isResolved(phase)) return 'done'
  if (phase.status === 'in_progress') return 'active'
  // A trip created weeks ahead sits dormant until activated; showing Activation as `next`
  // would falsely read as "about to happen any moment".
  if (phase.phase_type === 'activation' && tripStatus === 'created') return 'pending'
  return phase.phase_event_id === activePhaseEventId ? 'next' : 'pending'
}

/** Completed share of the plan, 0-100. Denominator is the plan's OWN length, which
 *  is why an 11-phase trip cannot render >100%. */
export function completionPct(phases: readonly PhaseDescriptor[]): number {
  if (phases.length === 0) return 0
  return Math.round((phases.filter(isResolved).length / phases.length) * 100)
}

/** The seal actually on the vehicle: the highest-sequence RESOLVED departure's. A
 *  cross-dock trip carries a different seal per leg, so take the last one, not the first.
 *  Resolved (not just completed) because a failed guard check still leaves that seal
 *  physically on the truck. */
export function currentSealNumber(phases: readonly PhaseDescriptor[]): string | null {
  const departures = sortedPlan(phases).filter(
    phase => phase.phase_type === 'departure' && isResolved(phase) && phase.seal_number !== null,
  )
  if (departures.length === 0) return null
  return departures[departures.length - 1].seal_number
}

/** Parcels actually SCANNED at the first pickup (not the manifest's declared total —
 *  see Consignment.parcel_count_expected via the manifest endpoint for that). The
 *  LOWEST-sequence loading: a cross-dock hub pickup is a later, different loading row. */
export function originScannedCount(phases: readonly PhaseDescriptor[]): number | null {
  return sortedPlan(phases).find(phase => phase.phase_type === 'loading')?.parcel_count_origin ?? null
}

/** Count recorded when delivery was CONFIRMED at the final stop. Read off the confirmation
 *  row, not unloading: parcel_count_destination is written there by advance_confirmation
 *  (orchestration/phase_service.py). Takes the LAST confirmation — on a cross-dock, an
 *  earlier stop's confirmation is a handover, not the destination. Null, never zero, means
 *  no count recorded yet. */
export function destinationScannedCount(phases: readonly PhaseDescriptor[]): number | null {
  return sortedPlan(phases).filter(phase => phase.phase_type === 'confirmation').at(-1)?.parcel_count_destination ?? null
}

/** The seal applied at THIS unloading's own leg's departure — mirrors the backend's
 *  _find_departure_for_leg (phase_service.py). A cross-dock trip has one departure per
 *  leg, so this must be leg-scoped, not trip-wide. Null if not yet recorded. */
export function departureSealForLeg(
  phases: readonly PhaseDescriptor[],
  unloadingPhase: PhaseDescriptor,
): string | null {
  const departures = sortedPlan(phases).filter(
    phase => phase.phase_type === 'departure'
      && phase.sequence_number < unloadingPhase.sequence_number
      && phase.seal_number !== null,
  )
  if (departures.length === 0) return null
  return departures[departures.length - 1].seal_number
}

/** When THIS leg actually departed, leg-scoped like departureSealForLeg. Never
 *  `in_transit.created_at`: every plan row is written at trip creation, so that column
 *  is trip-creation time, not departure time. Null until that departure completes. */
export function legDepartureAt(
  phases: readonly PhaseDescriptor[],
  inTransitPhase: PhaseDescriptor,
): string | null {
  const departures = sortedPlan(phases).filter(
    phase => phase.phase_type === 'departure'
      && phase.sequence_number < inTransitPhase.sequence_number
      && phase.completed_at !== null,
  )
  if (departures.length === 0) return null
  return departures[departures.length - 1].completed_at
}

export interface AnchorTally {
  /** Phases that owe a Hedera receipt — anchor_status !== 'not_required'. */
  owed: number
  anchored: number
  /** Fail-open casualties (parent D7). A completed phase with a failed anchor must
   *  never render as an unqualified success. */
  failed: number
}

/** Computed from anchor_status, never from plan length: exactly three phase TYPES
 *  are anchored, and a multi-stop plan may hold several departures. */
export function anchorTally(phases: readonly PhaseDescriptor[]): AnchorTally {
  return {
    owed:     phases.filter(p => p.anchor_status !== 'not_required').length,
    anchored: phases.filter(p => p.anchor_status === 'anchored').length,
    failed:   phases.filter(p => p.anchor_status === 'failed').length,
  }
}

export function phaseLabel(phase: PhaseDescriptor): string {
  return PHASE_NAMES[phase.phase_type]
}

/** The status chip's label and colour. An active or held trip's chip names its PHASE
 *  rather than the coarse "Active"/"Exception" collapse; `created`, `closed` and
 *  `cancelled` keep their own label. Falls back to TRIP_STATUS_META[status] when no
 *  phase is cached, rather than throwing. */
export function tripChipMeta(
  status: CoarseTripStatus,
  currentPhase: PhaseType | null,
): StatusMeta {
  const base = TRIP_STATUS_META[status]
  if (currentPhase === null) return base
  if (status === 'active') return { ...base, label: PHASE_NAMES[currentPhase] }
  // chipType stays 'exception', so the chip is amber whatever the label says.
  if (status === 'exception_hold') return { ...base, label: `⚠ ${PHASE_NAMES[currentPhase]}` }
  return base
}

/** Secondary header chip: what this trip has on record against it, or null for a clean
 *  trip. Needed because a closed trip with a recorded exception still shows "Complete"
 *  via tripChipMeta. Labelled "exception", not "unresolved" — there's no dispatcher
 *  resolve endpoint yet, so every trip would otherwise read as permanently unresolved. */
export function recordedExceptionLabel(
  exceptions: readonly TripException[],
  phases: readonly PhaseDescriptor[],
): string | null {
  const count = exceptions.length
  if (count > 0) return `${count} exception${count === 1 ? '' : 's'}`
  return phases.some(phase => phase.status === 'exception') ? 'Exception' : null
}

/** Build chain nodes from the ledger-derived counts the trip LIST carries. `total` is
 *  the plan's own length, computed server-side — never a constant. */
export function chainNodesFromCounts(
  total: number,
  completed: number,
  currentLabel: string,
): PhaseChainNode[] {
  return Array.from({ length: total }, (_, i): PhaseChainNode => ({
    key: `phase-${i}`,
    status: i < completed ? 'completed' : i === completed ? 'in_progress' : 'pending',
    label: i === completed ? currentLabel : `Phase ${i}`,
  }))
}
