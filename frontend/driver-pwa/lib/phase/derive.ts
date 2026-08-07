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

/**
 * Whether the driver is on the road right now — between the stop they departed and
 * the stop they are arriving at.
 *
 * This cannot be read off a status, and that is the whole reason this function exists.
 * `in_transit` never surfaces as the CURRENT phase: it carries no driver steps
 * (`STEP_SLUGS.in_transit` is empty) and the backend's `_auto_complete_in_transit`
 * (orchestration/phase_service.py) closes it the moment `departure` advances. By the
 * time the driver looks at their phone, `currentPhase()` already returns the arrival
 * phase. So the driving leg is derived from the SHAPE of the plan instead: the trip is
 * driving when the row immediately behind the current one is a resolved `in_transit`.
 *
 * Keyed on `sequence_number`, never on `phase_type` alone — a cross-dock plan carries
 * one `in_transit` per leg, and only the one directly behind the current row describes
 * the leg being driven now. LENGTH IS DATA (see the module header): nothing below
 * indexes a fixed position or assumes a plan length.
 *
 * Deliberately narrow: only an `unloading` arrival counts. A mid-route stop that only
 * collects cargo emits `in_transit` -> `loading`, which is left to the ordinary phase
 * card — widening this is a design decision, not a bug fix.
 */
export function isDriving(phases: readonly PhaseDescriptor[]): boolean {
  const ordered = bySequence(phases)
  const currentIndex = ordered.findIndex((phase) => !isResolved(phase))

  // -1 = every phase resolved (closed trip). 0 = the current row is the first in the
  // plan, so there is no preceding leg it could have been driven from.
  if (currentIndex < 1) return false
  if (ordered[currentIndex].phase_type !== 'unloading') return false

  const preceding = ordered[currentIndex - 1]
  // The resolved check is redundant by construction today (everything before the first
  // unresolved row is resolved), but it is stated because "a RESOLVED in_transit" is the
  // actual contract — a future change to how `currentIndex` is found must not silently
  // start reporting a pending leg as one already driven.
  return preceding.phase_type === 'in_transit' && isResolved(preceding)
}
