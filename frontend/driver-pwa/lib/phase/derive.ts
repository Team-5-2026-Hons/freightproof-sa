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

import type { PhaseDescriptor, PhaseEventId, PhaseStatus, PhaseStep } from '@shared/lib/types/phase'
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
 * The phase the DRIVER is working on: the lowest-sequence unresolved phase that has a
 * step recipe.
 *
 * Differs from `currentPhase()` only while the ledger sits on a STEPLESS row, and that is
 * not an edge case — it is the entire drive. `in_transit` carries no step recipe and the
 * backend holds it PENDING from departure until the driver submits arrival from the
 * in-transit hub's swipe (orchestration/phase_service.advance_in_transit). So for hours
 * at a time the ledger's current row is `in_transit` while the driver's next STEP-DRIVEN
 * action is `unloading`.
 *
 * "Stepless" is the right word here, not "driverless" — the row has an owner as of
 * 2026-08-09, it just isn't submitted from a step page. That is exactly why
 * STEP_SLUGS.in_transit stays empty: this function's skip is what keeps arrival off the
 * step router while still letting the hub submit it.
 *
 * The distinction is load-bearing, not cosmetic: a screen asking "where is this trip"
 * wants `currentPhase()`, and one asking "what does the driver do next" wants this. The
 * step screen asked the former and refused to open the arrival step because the ledger
 * had not reached it yet — which it never could, since submitting that step is what
 * advances the ledger.
 */
export function actionablePhase(phases: readonly PhaseDescriptor[]): PhaseDescriptor | null {
  return bySequence(phases).find(
    (phase) => !isResolved(phase) && STEP_SLUGS[phase.phase_type].length > 0,
  ) ?? null
}

/**
 * The phase to stamp on something that happens OUTSIDE a phase submission — a panic
 * hold, a breakdown, a seal found broken on the road. Answers "where was the driver
 * when this happened", which is `currentPhase()` (where the trip IS), never
 * `actionablePhase()` (what the driver does next).
 *
 * The distinction is the entire point here. For hours at a time the ledger sits on the
 * PENDING `in_transit` row while the driver's next action is `unloading`; a panic
 * pressed during that window belongs to the drive, not to the arrival the driver has
 * not made yet. `actionablePhase()` would say unloading and be wrong for every
 * exception raised on the road.
 *
 * Captured at the moment of the event and sent with it, so the backend stores WHERE it
 * happened instead of leaving the dispatcher to infer placement at render time — an
 * inference that silently re-runs as the trip advances, which made a 15:17 panic appear
 * to walk from Departure to Unloading to Confirmation.
 *
 * Null when the plan is empty or fully resolved; the backend derives its own placement
 * in that case rather than storing nothing.
 *
 * Tolerates a missing plan rather than trusting the type, because every caller is on an
 * error path: this runs inside the catch block that queues a panic alert when the
 * network call has already failed. A throw here would lose the alert AND strand the
 * driver on the panic screen — the one moment the app must not break. An untagged
 * exception is a small loss; an unsent one is the whole failure.
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
 * Whether the driver is on the road right now.
 *
 * One rule: the ledger's current row is an `in_transit`. That row is opened PENDING by
 * `departure` and closed by the driver's own arrival submission (backend
 * `advance_in_transit`, wired to the in-transit hub's swipe), so it is unresolved for
 * exactly as long as the truck is moving and no longer.
 *
 * There used to be a second case — "current is `unloading` AND the preceding `in_transit`
 * is resolved" — and deleting it was mandatory, not tidying. It was a fossil of the model
 * where `in_transit` auto-completed the instant `departure` landed, which made "a resolved
 * in_transit behind the current row" the ONLY way to detect a drive. Under driver-submitted
 * arrival that condition describes the driver standing still at the destination doing
 * seal-verify, so keeping it would have made Home offer "Continue driving" for the whole
 * unloading phase.
 *
 * Keyed on `sequence_number` via currentPhase, never on `phase_type` alone — a cross-dock
 * plan carries one `in_transit` per leg. LENGTH IS DATA (see the module header).
 */
export function isDriving(phases: readonly PhaseDescriptor[]): boolean {
  return currentPhase(phases)?.phase_type === 'in_transit'
}
