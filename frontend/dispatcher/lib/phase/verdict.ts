// The header verdict: one outcome per phase (icon + word + reasons on the card), answering
// "did this phase go cleanly?" without opening it. Pure (the clock arrives as `nowMs`) so
// vitest can prove it.
//
// Precedence, strongest first: overridden > attention > reviewed > unverified > clean >
// in_progress. An unreviewed critical exception on a running phase therefore outranks
// "In progress". The anchor state is NOT an input (D29): anchoring is forensic detail and
// today's separate "Anchor failed" warning is unchanged.

import { countLabel } from '@/lib/format/count'
import { fmtExceptionType } from '@/lib/format/exception'
import { fmtTime } from '@shared/lib/utils/datetime'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import type { TripStatus } from '@shared/lib/types/trip'
import type { PhaseCheck } from './checks'
import { isResolved, nodeTypeFor, type PhaseNodeType } from './derive'
import { exceptionTrigger } from './acts'

export type PhaseOutcome = 'overridden' | 'attention' | 'reviewed' | 'unverified' | 'clean' | 'in_progress' | 'current'

export interface PhaseVerdict {
  outcome: PhaseOutcome
  headline: string
  reasons: readonly string[]
  nodeType: PhaseNodeType
  /** True only when the outcome is `reviewed` and every exception on the phase was actually
   *  reviewed. A phase whose exceptions were merely recorded has the same outcome but nobody
   *  looked, so consumers must key the "reviewed" tick on this, never on the headline's words. */
  reviewed?: boolean
}

export interface PhaseVerdictInput {
  phase: PhaseDescriptor
  checks: readonly PhaseCheck[]
  /** Already scoped to this phase by the caller (trip-level exceptions belong to no phase). */
  exceptions: readonly TripException[]
  actCounts: { uploads: number }
  isActive: boolean
  tripStatus: TripStatus
  /** in_transit only (D41): `legDepartureAt(allPhases, phase)` and the phase's `completed_at`. */
  leg: { departedAt: string | null; arrivedAt: string | null } | null
  /** Only used for an unfinished leg's "time on the road". */
  nowMs: number
}

// Wording lives here, once. "Checks passed" says what the evidence establishes rather than
// passing a judgement on the phase (D44); the outcome key stays `clean`.
export const VERDICT_WORDING = {
  overridden: { headline: 'Closed by dispatcher override', reason: 'Checks did not run' },
  attention: 'Needs attention',
  reviewed: {
    reviewedOne: 'Exception reviewed',
    reviewedMany: 'Exceptions reviewed',
    recordedOne: 'Exception recorded',
    recordedMany: 'Exceptions recorded',
  },
  unverified: {
    headline: 'Not fully verified',
    noChecks: 'No checks ran',
    // The phase's own status says an exception was recorded, but none reached this module:
    // asserting "no exceptions" would claim an absence nobody observed.
    exceptionNotLoaded: 'Exception recorded on this phase; details not loaded',
  },
  // In transit nothing can pass: an empty list is absence of reports, not a safe route.
  transitUnverified: 'No exceptions recorded',
  // A clean phase says how much was checked, not what: the Checked zone lists each passing check,
  // so the header stays short and the phases that need reading stand out (distil, Batch 3).
  clean: { headline: 'Checks passed', noExceptions: 'No exceptions', checked: (n: number): string => countLabel(n, 'check') },
  inProgress: 'In progress',
  current: { headline: 'Current phase', reason: 'Waiting for the driver' },
  warehouseScan: 'Waiting for the warehouse scan to finish',
  waitingToConfirm: (verb: string): string => `Waiting for the driver to confirm ${verb}`,
  uploaded: (n: number): string => `${countLabel(n, 'photo')} uploaded`,
  toReview: (n: number): string => `${countLabel(n, 'exception')} to review`,
  enRoute: (total: number, needReview: number): string =>
    `${countLabel(total, 'exception')} en route, ${needReview} ${needReview === 1 ? 'needs' : 'need'} review`,
  departed: (time: string): string => `Departed ${time}`,
  onTheRoad: (duration: string): string => `${duration} on the road`,
} as const

// What the driver is asked to confirm in each phase (design note §7.5). "Confirm
// Confirmation" would read as a bug, so the noun is per phase type.
export const CONFIRM_VERBS: Record<PhaseType, string> = {
  trip_creation: 'creation',
  activation: 'arrival',
  loading: 'loading',
  departure: 'departure',
  in_transit: 'arrival',
  arrival: 'arrival',
  unloading: 'unloading',
  confirmation: 'delivery',
}

// The only `blocked_on` value the backend writes today; matches acts.ts.
const WAREHOUSE_SCAN_BLOCK = 'warehouse_scan'

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const MINUTE_PAD_WIDTH = 2

interface VerdictBody {
  outcome: PhaseOutcome
  headline: string
  reasons: readonly string[]
  reviewed?: boolean
}

// ── Time on the road (D41) ─────────────────────────────────────────────────────

function parseMs(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** "40 min" below an hour, "3 h 12 m" from an hour up. Whole minutes, rounded down. */
function formatRoadTime(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / MS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${minutes}\u00a0min`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  return `${hours}\u00a0h\u00a0${String(minutes % MINUTES_PER_HOUR).padStart(MINUTE_PAD_WIDTH, '0')}\u00a0m`
}

/** The leg's departure and duration. Both are left out, never guessed, when the departure is
 *  unknown; the duration is also left out when the clocks disagree (it would be negative).
 *  The clock stops at arrival, so a finished leg ignores `nowMs`. */
function legReasons(input: PhaseVerdictInput, finished: boolean): string[] {
  const { leg, nowMs } = input
  if (leg === null) return []
  const departedMs = parseMs(leg.departedAt)
  if (departedMs === null) return []
  const reasons: string[] = [VERDICT_WORDING.departed(fmtTime(leg.departedAt))]
  // The clock stops at arrival (D41): a finished leg with no arrival time has no duration,
  // rather than one that keeps ticking.
  if (finished && leg.arrivedAt === null) return reasons
  const endMs = leg.arrivedAt === null ? nowMs : parseMs(leg.arrivedAt)
  if (endMs !== null && Number.isFinite(endMs) && endMs >= departedMs) {
    reasons.push(VERDICT_WORDING.onTheRoad(formatRoadTime(endMs - departedMs)))
  }
  return reasons
}

// ── Outcome bodies, tried strongest first ──────────────────────────────────────

const needsReview = (exceptions: readonly TripException[]): TripException[] =>
  exceptions.filter(exception => exception.review_status === 'needs_review')

function describeException(exception: TripException): string {
  return `${fmtExceptionType(exception.exception_type)} (${exception.severity})`
}

function transitExceptionReasons(input: PhaseVerdictInput): string[] {
  const events = input.exceptions.filter(exception => exceptionTrigger(exception, input.phase) === 'event')
  const atArrival = input.exceptions.filter(exception => exceptionTrigger(exception, input.phase) === 'handshake').length
  return [
    ...(events.length ? [VERDICT_WORDING.enRoute(events.length, needsReview(events).length)] : []),
    ...(atArrival ? [`${atArrival} at arrival check`] : []),
  ]
}

function overriddenBody(input: PhaseVerdictInput): VerdictBody | null {
  if (input.phase.status !== 'overridden') return null
  const pending = needsReview(input.exceptions).length
  const { headline, reason } = VERDICT_WORDING.overridden
  return {
    outcome: 'overridden',
    headline,
    reasons: pending > 0 ? [reason, VERDICT_WORDING.toReview(pending)] : [reason],
  }
}

function attentionBody(input: PhaseVerdictInput): VerdictBody | null {
  const pending = needsReview(input.exceptions).length
  const flagged = input.checks.filter(check => check.result === 'flag')
  if (pending === 0 && flagged.length === 0) return null
  const inTransit = input.phase.phase_type === 'in_transit'
  const exceptionReason = pending === 0
    ? []
    : inTransit ? transitExceptionReasons(input) : [VERDICT_WORDING.toReview(pending)]
  return {
    outcome: 'attention',
    headline: VERDICT_WORDING.attention,
    reasons: [
      ...exceptionReason,
      ...flagged.map(check => check.title),
      ...(inTransit ? legReasons(input, isResolved(input.phase)) : []),
    ],
  }
}

function reviewedBody(input: PhaseVerdictInput): VerdictBody | null {
  const { exceptions, phase } = input
  if (!isResolved(phase) || exceptions.length === 0) return null
  const wording = VERDICT_WORDING.reviewed
  const single = exceptions.length === 1
  // Nothing needs review here, but an exception that was only recorded was never reviewed:
  // say so rather than borrow the word.
  const allReviewed = exceptions.every(exception => exception.review_status === 'reviewed')
  const headline = allReviewed
    ? (single ? wording.reviewedOne : wording.reviewedMany)
    : (single ? wording.recordedOne : wording.recordedMany)
  return {
    outcome: 'reviewed',
    reviewed: allReviewed,
    headline,
    reasons: [
      ...(phase.phase_type === 'in_transit' ? transitExceptionReasons(input) : [single ? describeException(exceptions[0]) : countLabel(exceptions.length, 'exception')]),
      ...(phase.phase_type === 'in_transit' ? legReasons(input, true) : []),
    ],
  }
}

/** A resolved phase with no exception and nothing flagged: clean-in-fact only if every check
 *  ran and at least one passed. A dark tracker is `unverified`, never `clean`. */
function settledBody(input: PhaseVerdictInput): VerdictBody | null {
  const { phase, checks } = input
  if (!isResolved(phase)) return null
  if (phase.status === 'exception') {
    // Reached only when `exceptions` is empty (reviewedBody ran first): the exceptions
    // resource is still loading, failed or did not match, so absence is unproven.
    const leg = phase.phase_type === 'in_transit' ? legReasons(input, true) : []
    return {
      outcome: 'unverified',
      headline: VERDICT_WORDING.unverified.headline,
      reasons: [VERDICT_WORDING.unverified.exceptionNotLoaded, ...leg],
    }
  }
  if (phase.phase_type === 'in_transit') {
    return { outcome: 'unverified', headline: VERDICT_WORDING.transitUnverified, reasons: legReasons(input, true) }
  }
  const passed = checks.filter(check => check.result === 'pass')
  const unrun = checks.filter(check => check.result === 'not_checked')
  if (unrun.length === 0 && passed.length > 0) {
    return {
      outcome: 'clean',
      headline: VERDICT_WORDING.clean.headline,
      reasons: [VERDICT_WORDING.clean.checked(passed.length)],
    }
  }
  const reasons = checks.filter(check => check.result === 'pass' || check.result === 'not_checked').map(check => check.title)
  return {
    outcome: 'unverified',
    headline: VERDICT_WORDING.unverified.headline,
    reasons: reasons.length > 0 ? reasons : [VERDICT_WORDING.unverified.noChecks],
  }
}

function waitingReason(phase: PhaseDescriptor): string {
  return phase.blocked_on === WAREHOUSE_SCAN_BLOCK ? VERDICT_WORDING.warehouseScan : VERDICT_WORDING.waitingToConfirm(CONFIRM_VERBS[phase.phase_type])
}

/** A phase that has not started shows a dashed card and nothing else. Activation on a trip
 *  that is still `created` is dormant even though the plan's first unresolved phase. */
function isNotStarted(input: PhaseVerdictInput): boolean {
  const dormant = input.phase.phase_type === 'activation' && input.tripStatus === 'created'
  return !input.isActive || dormant
}

function runningBody(input: PhaseVerdictInput): VerdictBody | null {
  const { phase, actCounts } = input
  if (isResolved(phase) || isNotStarted(input)) return null
  if (phase.phase_type === 'in_transit') {
    const leg = legReasons(input, false)
    return { outcome: 'in_progress', headline: VERDICT_WORDING.inProgress, reasons: leg.length > 0 ? leg : [waitingReason(phase)] }
  }
  if (actCounts.uploads > 0) {
    return {
      outcome: 'in_progress',
      headline: VERDICT_WORDING.inProgress,
      reasons: [VERDICT_WORDING.uploaded(actCounts.uploads), waitingReason(phase)],
    }
  }
  return { outcome: 'current', headline: VERDICT_WORDING.current.headline, reasons: [VERDICT_WORDING.current.reason] }
}

/** The rail node follows the outcome: amber for every `attention`, even on a phase whose
 *  status is `completed` (the Confirmation 7-out, 6-in case). */
function nodeTypeOf(body: VerdictBody, input: PhaseVerdictInput): PhaseNodeType {
  if (body.outcome === 'attention') return 'warn'
  return nodeTypeFor(input.phase, input.isActive ? input.phase.phase_event_id : null, input.tripStatus)
}

/** Null for trip_creation (no verdict this round), for an unresolved phase on a cancelled
 *  trip (it keeps "Not reached"), and for a phase that has not started. */
export function phaseVerdict(input: PhaseVerdictInput): PhaseVerdict | null {
  const { phase } = input
  if (phase.phase_type === 'trip_creation') return null
  if (!isResolved(phase) && input.tripStatus === 'cancelled') return null
  const body = overriddenBody(input)
    ?? attentionBody(input)
    ?? reviewedBody(input)
    ?? settledBody(input)
    ?? runningBody(input)
  if (body === null) return null
  return { ...body, nodeType: nodeTypeOf(body, input) }
}
