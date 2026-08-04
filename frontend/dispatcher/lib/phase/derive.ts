// The dispatcher's single source of "where is this trip, and what has it evidenced".
//
// Mirrors the backend's own derivation — orchestration/phase_service.py's _is_resolved
// predicate and recompute_position query — so the two surfaces cannot disagree about
// what "current" means. If this file and that one ever diverge, the backend wins and
// this is the bug.
//
// Deliberately pure: no React, no fetch, no clock. That is what lets vitest prove it,
// and it is the only net this stage can add — both static gates (tsc, eslint) passed
// green while the page this replaces was throwing a TypeError on every load.
//
// LENGTH IS DATA. Nothing here may assume 6 phases or sequence 0..6.

import type { CoarseTripStatus, PhaseDescriptor, PhaseEventId, PhaseStatus, PhaseType } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { TRIP_STATUS_META, type StatusMeta } from '@shared/lib/constants/status-meta'

/** How a phase renders in the timeline and in the chain.
 *
 * `active` and `next` are both "this is the phase the ledger is waiting on" —
 * the distinction is whether real work has actually begun. The backend never
 * writes `in_progress` today (every phase goes pending -> completed in one
 * step), so `active` is currently unreachable in practice; `next` is what a
 * freshly-created trip's activation phase gets instead of the misleading
 * "in progress" treatment. */
export type PhaseNodeType = 'done' | 'active' | 'next' | 'warn' | 'pending'

/** One node in a PhaseChain. Normalised so the trip LIST (which has counts but no
 *  plan) and any plan-holding caller can feed the same component — see U6. */
export interface PhaseChainNode {
  key: string
  status: PhaseStatus
  label: string
}

// Mirrors phase_service._is_resolved: a phase the ledger will never revisit.
// `exception` is NOT resolved — the trip is stuck on it, which is why it stays the
// active phase and renders as a warning rather than being skipped over.
const RESOLVED: readonly PhaseStatus[] = ['completed', 'overridden']

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
): PhaseNodeType {
  if (isResolved(phase)) return 'done'
  // Checked before the active test on purpose: an exception phase IS the active one
  // (it blocks the plan), and it must never render as ordinary progress.
  if (phase.status === 'exception') return 'warn'
  // Genuinely started (e.g. a driver has opened the step but not yet submitted it).
  // Reserved for a real in_progress write, which nothing server-side performs today —
  // see the PhaseNodeType doc comment.
  if (phase.status === 'in_progress') return 'active'
  // The ledger's current gate, but still `pending`: nothing has happened yet. A trip
  // created a week ahead must not show its first phase as already under way just
  // because it is next in line — that reads as active work when there is none.
  return phase.phase_event_id === activePhaseEventId ? 'next' : 'pending'
}

/** Completed share of the plan, 0-100. Denominator is the plan's OWN length, which
 *  is why an 11-phase trip cannot render >100%. */
export function completionPct(phases: readonly PhaseDescriptor[]): number {
  if (phases.length === 0) return 0
  return Math.round((phases.filter(isResolved).length / phases.length) * 100)
}

/** The seal actually on the vehicle: the highest-sequence COMPLETED departure's.
 *  A cross-dock trip carries a different seal per leg (parent D7/§2.6 — the seal is
 *  captured at departure, never at loading), so "the first seal we find" is wrong. */
export function currentSealNumber(phases: readonly PhaseDescriptor[]): string | null {
  const departures = sortedPlan(phases).filter(
    phase => phase.phase_type === 'departure' && isResolved(phase) && phase.seal_number !== null,
  )
  if (departures.length === 0) return null
  return departures[departures.length - 1].seal_number
}

/** The origin pickup's count: the LOWEST-sequence loading. On a cross-dock the hub
 *  pickup is a different, later loading row and is not the origin count. */
export function originParcelCount(phases: readonly PhaseDescriptor[]): number | null {
  return sortedPlan(phases).find(phase => phase.phase_type === 'loading')?.parcel_count_origin ?? null
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

/** The status chip's label and colour — U13.
 *
 * An active trip's chip names its PHASE, because the coarse collapse otherwise takes
 * six readable chip labels down to the single word "Active" and the chip is what a
 * dispatcher reads at a glance. A held trip names its phase too, behind a warning
 * prefix: being held and where it stopped are two different facts and a dispatcher
 * needs both. `created`, `closed` and `cancelled` keep their own label — terminal or
 * pre-start states where the position adds nothing.
 *
 * Falls back to TRIP_STATUS_META[status] whenever there is no cached phase. That
 * should not happen — create_trip seeds the cache (U4) and every advance recomputes
 * it — but degrading to "Active" / "Exception" is the point: returning undefined
 * here is live defect #4, the TypeError this stage exists to fix.
 */
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

/** Build chain nodes from the ledger-derived counts the trip LIST carries.
 *  `total` is the plan's own length, computed server-side — not a constant, and not
 *  inferred from trip.status the way the deleted chainNodesFromStatus was. */
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
