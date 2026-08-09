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
import type { TripException } from '@shared/lib/types/exception'
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

// Mirrors phase_service._is_resolved exactly: a phase the ledger will never revisit.
//
// `exception` IS resolved, because the backend says so — "it already happened, the
// trip already moved on, and the anomaly is recorded on the row itself". A seal
// mismatch at departure sets EXCEPTION and the trip still departs, still unloads and
// still closes. This list previously excluded it on the stated grounds that "the trip
// is stuck on it", which was simply not true of the backend, and the divergence made
// the dispatcher wrong in three places at once: activePhase() pinned to the exception
// row so the header chip named the wrong phase, completionPct() could never reach 100%
// on a closed trip, and — worst — every still-unresolved later row lost its `next`
// slot and rendered `pending`, which page.tsx reads as isPending and uses to suppress
// alwaysExpandedContent. That hid the in-transit Journey card for the whole drive on
// exactly the seal-mismatch trips it exists to show.
//
// Keeping exception phases visually distinct is still right, and is nodeTypeFor's job
// (it checks the status directly, above this predicate) — not this predicate's.
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
  // Checked FIRST, above isResolved, and the order is load-bearing: `exception` is a
  // resolved status (see RESOLVED), so testing isResolved first would return 'done' and
  // render a seal mismatch as ordinary green progress. An exception is resolved for
  // sequencing and still an anomaly for display — those are different questions, and
  // this is where the second one is answered.
  if (phase.status === 'exception') return 'warn'
  if (isResolved(phase)) return 'done'
  // Genuinely started (e.g. a driver has opened the step but not yet submitted it).
  // Reserved for a real in_progress write, which nothing server-side performs today —
  // see the PhaseNodeType doc comment.
  if (phase.status === 'in_progress') return 'active'
  // A trip created weeks ahead sits dormant until a driver opens it — Activation is
  // not "next in line" the way every later phase is, it IS the start of the trip.
  // Rendering it as `next` (the ledger's current gate) reads as "about to happen any
  // moment", which is false for a trip that may not be touched for days. It stays
  // `pending`, indistinguishable from a phase that hasn't been reached yet, until the
  // driver actually activates and trip.status leaves 'created'.
  if (phase.phase_type === 'activation' && tripStatus === 'created') return 'pending'
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

/** The seal actually on the vehicle: the highest-sequence RESOLVED departure's.
 *  A cross-dock trip carries a different seal per leg (parent D7/§2.6 — the seal is
 *  captured at departure, never at loading), so "the first seal we find" is wrong.
 *
 *  Resolved, not merely completed: a departure whose guard check failed is EXCEPTION,
 *  and the driver still applied and photographed `seal_number` — that seal is physically
 *  on the truck whatever the guard re-entered. Excluding it (as this did while
 *  `exception` sat outside RESOLVED) blanked the seal field on precisely the
 *  mismatch trips a dispatcher opens the record to read. */
export function currentSealNumber(phases: readonly PhaseDescriptor[]): string | null {
  const departures = sortedPlan(phases).filter(
    phase => phase.phase_type === 'departure' && isResolved(phase) && phase.seal_number !== null,
  )
  if (departures.length === 0) return null
  return departures[departures.length - 1].seal_number
}

/** How many parcels the origin depot actually SCANNED onto the truck at the first
 *  pickup — not the manifest's declared total, which is no longer stored on the row
 *  (that comes from Consignment.parcel_count_expected via the manifest endpoint).
 *  The LOWEST-sequence loading: on a cross-dock the hub pickup is a different, later
 *  loading row and is not the origin count. */
export function originScannedCount(phases: readonly PhaseDescriptor[]): number | null {
  return sortedPlan(phases).find(phase => phase.phase_type === 'loading')?.parcel_count_origin ?? null
}

/** The seal applied at THIS unloading's own leg's departure — mirrors the backend's
 *  _find_departure_for_leg (phase_service.py): the highest-sequence departure strictly
 *  before this unloading row, never "the trip's" departure. A cross-dock trip has one
 *  departure per leg, so a trip-wide lookup would compare leg 2's arrival against leg
 *  1's seal. Null if no preceding departure has a seal recorded yet. */
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

/** When THIS leg actually departed: the `completed_at` of the highest-sequence departure
 *  strictly before the given in-transit row. Leg-scoped for the same reason
 *  departureSealForLeg is — a cross-dock trip has one departure per leg, so "the trip's
 *  departure" would date leg 2 from leg 1's exit. Null until that departure completes.
 *
 *  Never `in_transit.created_at`: every row in the plan is written when the plan is
 *  GENERATED at trip creation, so created_at on an in-transit row is trip-creation time.
 *  Dating a departure from it prints a timestamp before the trip existed — which is
 *  exactly what the timeline did before this existed. */
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

/** Secondary header chip: what this trip has on record against it, or null for a clean
 *  trip.
 *
 * Exists because the coarse status chip alone lies by omission on a closed trip. A trip
 * that reaches `closed` with an exception recorded still renders "Complete" in green —
 * TRIP_STATUS_META['closed'] is returned unchanged by tripChipMeta — so the one fact a
 * dispatcher most needs at a glance is the one the header drops.
 *
 * Deliberately NOT labelled "unresolved". No resolve workflow exists yet (the backend has
 * no dispatcher resolve endpoint, so `resolved` is false on every real record), which
 * would make every trip read as permanently unresolved and imply an action nobody can
 * take. "1 exception" is true either way: a recorded exception is an evidential fact
 * whether or not it is ever actioned.
 *
 * Counts RECORDS first because those are what the timeline renders. A phase sitting in
 * `exception` status with no record attached still reports, unquantified — a held plan
 * with nothing written against it is rare but must not read as clean. */
export function recordedExceptionLabel(
  exceptions: readonly TripException[],
  phases: readonly PhaseDescriptor[],
): string | null {
  const count = exceptions.length
  if (count > 0) return `${count} exception${count === 1 ? '' : 's'}`
  return phases.some(phase => phase.status === 'exception') ? 'Exception' : null
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
