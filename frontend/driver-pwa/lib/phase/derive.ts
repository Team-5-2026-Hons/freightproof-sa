// Pure derivation over a trip's phase plan — the one place that knows "where is this
// trip right now" from the ledger. Mirrors the backend's own derivation
// (orchestration/phase_service.py); if the two diverge, the backend wins.
//
// LENGTH IS DATA: a phase type can occur more than once per plan (cross-dock repeats
// `unloading`). Position is always resolved via `sequence_number`, never `phase_type` alone.

import type { PhaseDescriptor, PhaseEventId, PhaseStatus, PhaseStep } from '@shared/lib/types/phase'
import { ANCHORED_PHASES, STEP_NAMES, STEP_SLUGS } from '@shared/lib/constants/phase-meta'

// Mirrors backend `_is_resolved` exactly. Differs from the dispatcher's own
// `isResolved`, which excludes `exception` so it keeps rendering as an active warning
// there — this module only cares where the driver goes next.
const RESOLVED_STATUSES: readonly PhaseStatus[] = ['completed', 'exception', 'overridden']

function isResolved(phase: PhaseDescriptor): boolean {
  return RESOLVED_STATUSES.includes(phase.status)
}

// Plan order is never trusted off the wire — always re-sort by sequence_number
// before walking it.
function bySequence(phases: readonly PhaseDescriptor[]): PhaseDescriptor[] {
  return [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
}

/**
 * The lowest-sequence unresolved phase, or null once the trip is closed. Re-derives
 * from the ledger every call — never trusts a cached "current phase".
 */
export function currentPhase(phases: readonly PhaseDescriptor[]): PhaseDescriptor | null {
  return bySequence(phases).find((phase) => !isResolved(phase)) ?? null
}

/**
 * The phase the DRIVER is working on: the lowest-sequence unresolved phase that has a
 * step recipe. Differs from `currentPhase()` while the ledger sits on a stepless row —
 * `in_transit` has no step recipe and stays PENDING for the whole drive, so for hours the
 * ledger's current row is `in_transit` while the driver's next step-driven action is
 * `unloading`. Use `currentPhase()` for "where is this trip"; use this for "what does the
 * driver do next".
 */
export function actionablePhase(phases: readonly PhaseDescriptor[]): PhaseDescriptor | null {
  return bySequence(phases).find(
    (phase) => !isResolved(phase) && STEP_SLUGS[phase.phase_type].length > 0,
  ) ?? null
}

/**
 * The phase to stamp on something OUTSIDE a phase submission (panic, breakdown, a seal
 * found broken) — "where was the driver when this happened", i.e. `currentPhase()`, not
 * `actionablePhase()`. A panic during the `in_transit` PENDING window belongs to the
 * drive, not the arrival the driver hasn't made yet.
 *
 * Null when the plan is empty or fully resolved. Tolerates a missing plan rather than
 * trusting the type — every caller is on an error path (queuing a panic alert after a
 * failed network call), where a throw here would strand the driver on the panic screen.
 */
export function contextPhaseEventId(phases: readonly PhaseDescriptor[] | null | undefined): PhaseEventId | null {
  if (!phases) return null
  return currentPhase(phases)?.phase_event_id ?? null
}

/**
 * The capture steps for a phase, resolved from STEP_SLUGS[phase.phase_type]. Empty
 * for phases with no driver interaction (e.g. trip_creation).
 */
export function stepsFor(phase: PhaseDescriptor): PhaseStep[] {
  const slugs = STEP_SLUGS[phase.phase_type]
  const names = STEP_NAMES[phase.phase_type]

  return slugs.map((slug, stepIndex) => ({
    phase_event_id: phase.phase_event_id,
    stepIndex,
    slug,
    displayName: names[stepIndex],
  }))
}

/**
 * `{ completed, total }` for a progress indicator. `total` is `phases.length` — data,
 * not a constant — so a longer cross-dock plan never renders a shorter plan's total.
 */
export function planProgress(phases: readonly PhaseDescriptor[]): { completed: number; total: number } {
  return {
    completed: phases.filter(isResolved).length,
    total: phases.length,
  }
}

/** Whether this phase carries a Hedera anchor. */
export function isAnchored(phase: PhaseDescriptor): boolean {
  return ANCHORED_PHASES.includes(phase.phase_type)
}

/**
 * Whether the driver is on the road right now: the ledger's current row is `in_transit`,
 * opened PENDING by `departure` and closed only by the driver's own arrival submission
 * (`advance_in_transit`). There is deliberately no second case for "current is
 * `unloading` and the preceding `in_transit` is resolved" — that was a fossil of an
 * auto-completing in_transit and would make Home offer "Continue driving" throughout
 * unloading. Keyed on `sequence_number`, never `phase_type` alone (LENGTH IS DATA).
 */
export function isDriving(phases: readonly PhaseDescriptor[]): boolean {
  return currentPhase(phases)?.phase_type === 'in_transit'
}
