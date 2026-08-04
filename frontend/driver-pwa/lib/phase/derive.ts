// Pure derivation over a trip's phase plan — the one place that knows how to find
// "where is this trip right now" from the ledger. Every driver-pwa screen that needs
// position, steps, or progress imports from here instead of re-deriving it inline.
//
// Mirrors the backend's own derivation — orchestration/phase_service.py's
// `_is_resolved` predicate and `recompute_position`'s walk — so this surface cannot
// disagree with the backend about what "current" means. If this file and that one
// ever diverge, the backend wins and this is the bug.
//
// LENGTH IS DATA. A trip's plan is generated at creation with a length that depends
// on its stops, and a phase TYPE can occur more than once in one plan (a cross-dock
// visits `unloading` several times). Nothing here may assume a length, and position
// is always resolved via `sequence_number`, never by matching on `phase_type` alone.

import type { PhaseDescriptor, PhaseStatus, PhaseStep } from '@shared/lib/types/phase'
import { ANCHORED_PHASES, STEP_NAMES, STEP_SLUGS } from '@shared/lib/constants/phase-meta'

// Mirrors backend `_is_resolved` (orchestration/phase_service.py) exactly: a phase
// the ledger will never revisit. Note this deliberately differs from the dispatcher's
// own `isResolved` (frontend/dispatcher/lib/phase/derive.ts), which excludes
// `exception` on purpose so an exception phase keeps rendering as an active warning
// there. This module has no such presentational concern — it drives where the
// DRIVER goes next, and the backend's own gating already moved past an exception
// phase (the anomaly is recorded on the row itself), so the walk must too.
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
 * The lowest-sequence phase that is not yet resolved. Null once every phase is
 * resolved (the trip is closed). Mirrors the backend's next-phase walk, which
 * re-derives from the ledger every call and never trusts a cached "current phase".
 */
export function currentPhase(phases: readonly PhaseDescriptor[]): PhaseDescriptor | null {
  return bySequence(phases).find((phase) => !isResolved(phase)) ?? null
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
 * `{ completed, total }` for a progress indicator. `total` is `phases.length` —
 * DATA, not a constant — so a longer cross-dock plan can never render its total as
 * if it were a shorter single-leg one.
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
