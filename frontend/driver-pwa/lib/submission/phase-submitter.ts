// A phase submission that OUTLIVES the screen that started it: module scope, in memory,
// keyed by phase_event_id, unaffected by any component unmounting — so navigating away
// mid-submit no longer strands the driver watching a "Submitting…" track.
//
// Not routed through the localStorage queue (lib/hooks/useOfflineQueue.ts): photo
// evidence as base64 would exhaust the ~5MB quota in a single trip. That queue stays the
// FAILURE path, reached from here via `enqueuePhase` when a submission fails recoverably.
'use client'

import { useSyncExternalStore } from 'react'
import { submitPhase } from '@/lib/api/phases'
import { ApiError } from '@/lib/api/client'
import { isQueueableFailure } from '@/lib/utils/is-queueable-failure'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type { PhaseEvidence } from '@/lib/types/evidence-draft'
import type { DriverPosition } from '@/lib/types/location'

// Longest this module waits on the driver's phone for a fix before submitting without
// one — one second past useLocation's own 10s ceiling, so a normal GPS timeout classifies
// itself first. Nobody is watching a screen while this runs, so a generous budget is affordable.
const POSITION_CAPTURE_BUDGET_MS = 12_000

// How old the last known fix may be and still honestly describe where the driver is
// standing now. A stale coordinate presented as a phase's confirmed position is
// fabricated evidence — anything older is dropped, and the submission carries no
// position, which every phase except `activation` accepts.
const POSITION_FALLBACK_MAX_AGE_MS = 60_000

interface TimestampedFix {
  position: DriverPosition
  capturedAtMs: number
}

// The most recent fix any submission managed to take. Module scope so it survives the
// screen that captured it.
let lastKnownFix: TimestampedFix | null = null

function rememberFix(position: DriverPosition): void {
  lastKnownFix = { position, capturedAtMs: Date.now() }
}

function recentFix(): DriverPosition | null {
  if (lastKnownFix === null) return null
  return Date.now() - lastKnownFix.capturedAtMs <= POSITION_FALLBACK_MAX_AGE_MS
    ? lastKnownFix.position
    : null
}

// Resolves null rather than rejecting or hanging: a failed fix is normal (a warehouse
// roof, a denied permission) and must never be the reason evidence goes unrecorded.
async function resolvePosition(pending: Promise<DriverPosition | null>): Promise<DriverPosition | null> {
  const captured = await new Promise<DriverPosition | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), POSITION_CAPTURE_BUDGET_MS)
    void pending.then(
      (position) => { clearTimeout(timer); resolve(position) },
      // Never surfaced to the driver: reaching here means an unexpected shape, not a GPS problem.
      (err: unknown) => {
        clearTimeout(timer)
        console.error('phase-submitter: position capture rejected', err)
        resolve(null)
      },
    )
  })

  if (captured !== null) {
    rememberFix(captured)
    return captured
  }
  // A late capture still feeds the cache for the next submission even though this one
  // couldn't wait for it.
  void pending.then((late) => { if (late !== null) rememberFix(late) }, () => {})
  return recentFix()
}

/**
 * What actually became of a submission. The caller turns these into draft clearing,
 * trip reconciliation, toasts and navigation — this module never renders or routes.
 */
export type PhaseSubmissionOutcome =
  /** The backend has the evidence. `trip` is null only in demo mode (no call happened). */
  | { kind: 'recorded'; trip: Trip | null; addressedPhase: PhaseDescriptor | null }
  /** Recorded, and the trip is now held for dispatcher review. */
  | { kind: 'hold'; trip: Trip }
  /** Nothing reached the backend; the evidence is in the localStorage retry queue. */
  | { kind: 'queued' }
  /** A genuine 409: the ledger will not accept this phase right now. */
  | { kind: 'conflict'; message: string }
  /** A terminal 4xx or a local validation throw. Retrying unchanged cannot help. */
  | { kind: 'failed'; message: string }

/** A terminal failure the driver has not yet acknowledged. Surfaced by OfflineBanner. */
export interface PhaseSubmissionFailure {
  phaseEventId: string
  phaseType: PhaseType
  message: string
}

export interface PhaseSubmissionStoreState {
  /** phase_event_ids with a submission running right now. */
  inFlight: readonly string[]
  failures: readonly PhaseSubmissionFailure[]
}

/** Enqueue signature borrowed from useOfflineQueue — injected, never imported as a hook. */
type EnqueuePhase = (
  tripId: string,
  phaseEventId: string,
  phaseType: PhaseType,
  evidence: PhaseEvidence,
  position: DriverPosition | null,
  driverCapturedAt: string,
) => void

export interface PhaseSubmissionRequest {
  tripId: string
  phaseEventId: string
  phaseType: PhaseType
  evidence: PhaseEvidence
  /**
   * One key per logical attempt, reused across retries of that attempt — the online
   * counterpart to the offline queue's own per-entry key. Generated by the caller.
   */
  idempotencyKey: string
  /**
   * The driver's fix as a PROMISE, not a value — keeps the swipe instant, since the
   * caller never awaits GPS before navigating, while the fix still travels with the
   * evidence because the submission itself waits for it.
   */
  position: Promise<DriverPosition | null>
  /**
   * The instant the caller considers this attempt submitted — generated once per
   * logical attempt and reused across retries, so a replay reports the original
   * swipe instant, never a retry's own clock.
   */
  driverCapturedAt: string
  /** The localStorage failure path (lib/hooks/useOfflineQueue.ts). */
  enqueuePhase: EnqueuePhase
  /** Used ONLY to resolve a 409 — did an earlier attempt of this phase already land? */
  refetchTrip: () => Promise<Trip | null>
  /** Called exactly once, after the submission settles, from wherever the driver now is. */
  onOutcome: (outcome: PhaseSubmissionOutcome) => void
}

type StoreListener = () => void

const listeners = new Set<StoreListener>()

const EMPTY_STATE: PhaseSubmissionStoreState = { inFlight: [], failures: [] }

let state: PhaseSubmissionStoreState = EMPTY_STATE

// Frozen so useSyncExternalStore's server/hydration snapshot stays referentially stable.
const SERVER_SNAPSHOT: PhaseSubmissionStoreState = EMPTY_STATE

function publish(next: PhaseSubmissionStoreState): void {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: StoreListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): PhaseSubmissionStoreState {
  return state
}

function getServerSnapshot(): PhaseSubmissionStoreState {
  return SERVER_SNAPSHOT
}

/** Live view of what is submitting and what has failed. Safe to mount many times. */
export function usePhaseSubmissions(): PhaseSubmissionStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Acknowledge one terminal failure notice. */
export function dismissPhaseSubmissionFailure(phaseEventId: string): void {
  publish({
    ...state,
    failures: state.failures.filter((failure) => failure.phaseEventId !== phaseEventId),
  })
}

/**
 * Test-only reset — the store and in-flight registry are module scope by design, so
 * vitest's per-test isolation can't clear them (mirrors `__resetOfflineQueueStoreForTests`).
 */
export function __resetPhaseSubmitterForTests(): void {
  running.clear()
  lastKnownFix = null
  publish(EMPTY_STATE)
}

// phase_event_ids currently running. Belt-and-braces against a double submit: a stale
// tab or deep link should not be able to fire a second POST for the same ledger row.
const running = new Set<string>()

// Mirrors lib/phase/derive.ts's RESOLVED_STATUSES: completed, exception and overridden
// all mean the ledger is done with this row.
function isResolvedPhase(phase: PhaseDescriptor | null): boolean {
  return phase !== null && phase.status !== 'pending' && phase.status !== 'in_progress'
}

function addressedPhaseOf(trip: Trip | null, phaseEventId: string): PhaseDescriptor | null {
  return trip?.phases.find((phase) => phase.phase_event_id === phaseEventId) ?? null
}

const DEFAULT_CONFLICT_MESSAGE = 'Trip state changed unexpectedly. Please retry from the trip screen.'
const DEFAULT_TERMINAL_MESSAGE = 'Could not submit. Please try again.'

async function runSubmission(request: PhaseSubmissionRequest): Promise<PhaseSubmissionOutcome> {
  const { tripId, phaseEventId, phaseType, evidence, idempotencyKey, driverCapturedAt } = request
  const position = await resolvePosition(request.position)

  try {
    const result = await submitPhase(
      tripId, phaseEventId, phaseType, evidence, idempotencyKey, position, driverCapturedAt,
    )
    if (result.trip !== null && result.trip.status === 'exception_hold') {
      return { kind: 'hold', trip: result.trip }
    }
    return { kind: 'recorded', trip: result.trip, addressedPhase: addressedPhaseOf(result.trip, phaseEventId) }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // A duplicate submit of an already-resolved phase also 409s, so the only way to
      // tell "this already succeeded" apart from a genuine conflict is to refetch and
      // read the addressed phase's own status off the returned plan.
      let fetched: Trip | null = null
      try {
        fetched = await request.refetchTrip()
      } catch (refetchErr: unknown) {
        // Offline right after a 409 — can't tell replay from conflict, and guessing
        // "already recorded" would falsely tell the driver their evidence landed.
        console.error('phase-submitter: could not refetch the trip to resolve a 409', refetchErr)
        return { kind: 'conflict', message: err.message || DEFAULT_CONFLICT_MESSAGE }
      }

      if (fetched !== null && fetched.status === 'exception_hold') {
        return { kind: 'hold', trip: fetched }
      }
      const addressedPhase = addressedPhaseOf(fetched, phaseEventId)
      if (isResolvedPhase(addressedPhase)) {
        return { kind: 'recorded', trip: fetched, addressedPhase }
      }
      // The server's own 409 detail, not a hardcoded sentence — it describes the actual
      // cause (an unresolved earlier phase, a trip not yet due).
      return { kind: 'conflict', message: err.message || DEFAULT_CONFLICT_MESSAGE }
    }

    if (isQueueableFailure(err)) {
      // Queue for retry once connectivity/the server recovers. Position and capture
      // instant travel with the entry so a replay hours later reports the truth.
      request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt)
      return { kind: 'queued' }
    }

    // Terminal: a client-side 4xx or a local validation error. Neither can succeed on
    // retry, so queuing it would hand the driver a receipt for evidence that never lands.
    return { kind: 'failed', message: err instanceof Error ? err.message : DEFAULT_TERMINAL_MESSAGE }
  }
}

function settle(request: PhaseSubmissionRequest, outcome: PhaseSubmissionOutcome): void {
  running.delete(request.phaseEventId)

  const inFlight = state.inFlight.filter((id) => id !== request.phaseEventId)
  const isTerminal = outcome.kind === 'failed' || outcome.kind === 'conflict'
  const failures = isTerminal
    ? [
        // Replace any earlier notice for this same phase rather than stacking duplicates.
        ...state.failures.filter((failure) => failure.phaseEventId !== request.phaseEventId),
        { phaseEventId: request.phaseEventId, phaseType: request.phaseType, message: outcome.message },
      ]
    : state.failures.filter((failure) => failure.phaseEventId !== request.phaseEventId)

  publish({ inFlight, failures })

  // Runs last, outside the store update, so a throwing subscriber can't leave a phase
  // stuck in `inFlight` forever.
  request.onOutcome(outcome)
}

/**
 * Hand a phase submission to the background and return immediately.
 *
 * @returns false when a submission for this phase_event_id is already running, in which
 * case nothing new was started — the caller should still navigate, because the driver's
 * evidence is already on its way.
 */
export function startPhaseSubmission(request: PhaseSubmissionRequest): boolean {
  // Attached before the dedupe check so an ignored request can't leave an unhandled rejection.
  const guardedRequest: PhaseSubmissionRequest = {
    ...request,
    position: request.position.catch((err: unknown) => {
      console.error('phase-submitter: position capture rejected', err)
      return null
    }),
  }

  if (running.has(request.phaseEventId)) return false
  running.add(request.phaseEventId)
  publish({
    inFlight: [...state.inFlight, request.phaseEventId],
    // A fresh attempt supersedes the previous notice for the same phase.
    failures: state.failures.filter((failure) => failure.phaseEventId !== request.phaseEventId),
  })

  void runSubmission(guardedRequest).then(
    (outcome) => settle(guardedRequest, outcome),
    (err: unknown) => {
      // runSubmission catches everything it expects; reaching here means a defect in
      // this module rather than a submission failure. Never swallow it, and never leave
      // the phase marked in-flight.
      console.error('phase-submitter: submission threw unexpectedly', err)
      settle(guardedRequest, {
        kind: 'failed',
        message: err instanceof Error ? err.message : DEFAULT_TERMINAL_MESSAGE,
      })
    },
  )

  return true
}
