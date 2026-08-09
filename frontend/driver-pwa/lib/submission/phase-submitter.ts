// frontend/driver-pwa/lib/submission/phase-submitter.ts
//
// A phase submission that OUTLIVES the screen that started it.
//
// Before this module, `usePhaseStepController.submitAndAdvance` awaited the whole round
// trip — GPS fix, photo uploads, the POST, and the server-side Hedera anchor — inside a
// promise tied to the mounted step component. Navigating away mid-submit was impossible
// by construction, so the driver stood at a loading bay watching a "Submitting…" track
// for the entire journey of their evidence. The work lives here instead: module scope,
// in memory, keyed by phase_event_id, unaffected by any component unmounting.
//
// WHY NOT the existing localStorage queue (lib/hooks/useOfflineQueue.ts). Photo evidence
// travels as base64 data URLs. Routing every submit through that queue would write
// megabytes into localStorage on every phase and exhaust the ~5MB quota inside a single
// trip. The localStorage queue stays exactly what it has always been: the FAILURE path,
// reached from here via `enqueuePhase` when a submission fails in a way a retry could fix.
'use client'

import { useSyncExternalStore } from 'react'
import { submitPhase } from '@/lib/api/phases'
import { ApiError } from '@/lib/api/client'
import { isQueueableFailure } from '@/lib/utils/is-queueable-failure'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type { PhaseEvidence } from '@/lib/types/evidence-draft'
import type { DriverPosition } from '@/lib/types/location'

// ─── Position budget ───────────────────────────────────────────────────────────

// Longest this module waits on the driver's phone for a fix before submitting without
// one. Deliberately one second past useLocation's own 10s geolocation ceiling, so a
// normal GPS timeout gets to classify itself (and log its reason) rather than being cut
// off here. Nobody is watching a screen while this runs — the driver is already on Home
// — which is the whole reason a budget this generous is affordable.
const POSITION_CAPTURE_BUDGET_MS = 12_000

// How old the last known fix may be and still honestly describe where the driver is
// standing NOW. A stale coordinate presented as the position at which a phase was
// confirmed is fabricated evidence, which is the single worst defect this platform can
// ship — so the fallback is deliberately tighter than any plausible driving interval.
// Phases are confirmed stationary at gates and bays, where a minute-old fix is the same
// fix; anything older is dropped and the submission simply carries no position, which
// every phase except `activation` accepts (see lib/api/phases.ts).
const POSITION_FALLBACK_MAX_AGE_MS = 60_000

interface TimestampedFix {
  position: DriverPosition
  capturedAtMs: number
}

// The most recent fix any submission managed to take. Module scope for the same reason
// everything else here is: it has to survive the screen that captured it.
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
      // Never surfaced to the driver: capturePosition already handles and classifies its
      // own failures, so reaching here means an unexpected shape, not a GPS problem.
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
  // A capture that lands AFTER the budget still tells the next submission where the
  // driver is, so the cache is fed even when this submission could not wait for it.
  void pending.then((late) => { if (late !== null) rememberFix(late) }, () => {})
  return recentFix()
}

// ─── Outcomes ──────────────────────────────────────────────────────────────────

/**
 * What actually became of a submission. The caller turns these into draft clearing,
 * trip reconciliation, toasts and navigation — this module never renders anything and
 * never routes, so it stays testable without React.
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
) => void

export interface PhaseSubmissionRequest {
  tripId: string
  phaseEventId: string
  phaseType: PhaseType
  evidence: PhaseEvidence
  /**
   * One key per logical attempt, reused across retries of THAT attempt — the online
   * counterpart to the offline queue's own per-entry key. Generated by the caller (the
   * step controller) rather than here, so a retry of the same attempt can present the
   * same key even though this module treats each start as a fresh run.
   */
  idempotencyKey: string
  /**
   * The driver's fix, handed over as a PROMISE rather than a value. This is what keeps
   * the swipe instant: the caller never awaits GPS before navigating, and the fix still
   * travels WITH the evidence (including into the offline queue) because the submission
   * itself waits for it. A position taken later would claim the driver was somewhere
   * they weren't.
   */
  position: Promise<DriverPosition | null>
  /** The localStorage failure path (lib/hooks/useOfflineQueue.ts). */
  enqueuePhase: EnqueuePhase
  /** Used ONLY to resolve a 409 — did an earlier attempt of this phase already land? */
  refetchTrip: () => Promise<Trip | null>
  /** Called exactly once, after the submission settles, from wherever the driver now is. */
  onOutcome: (outcome: PhaseSubmissionOutcome) => void
}

// ─── Store ─────────────────────────────────────────────────────────────────────

type StoreListener = () => void

const listeners = new Set<StoreListener>()

const EMPTY_STATE: PhaseSubmissionStoreState = { inFlight: [], failures: [] }

let state: PhaseSubmissionStoreState = EMPTY_STATE

// Frozen constant so useSyncExternalStore's server/hydration snapshot is referentially
// stable — same trick useOfflineQueue uses for its own store.
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
 * Test-only reset. The store and the in-flight registry are module scope by design (that
 * is the entire point of this file), so vitest's per-test isolation cannot clear them —
 * mirrors `__resetOfflineQueueStoreForTests` for exactly the same reason.
 */
export function __resetPhaseSubmitterForTests(): void {
  running.clear()
  lastKnownFix = null
  publish(EMPTY_STATE)
}

// ─── Submission ────────────────────────────────────────────────────────────────

// phase_event_ids currently running. Belt-and-braces against a double submit: the
// optimistic advance in TripContext already stops the driver re-entering a step whose
// submission is in flight, but a stale tab or a deep link should not be able to fire a
// second POST for the same ledger row either.
const running = new Set<string>()

// Mirrors lib/phase/derive.ts's RESOLVED_STATUSES (private to that module): completed,
// exception and overridden all mean the ledger is done with this row. Only pending and
// in_progress leave room for a genuinely fresh attempt.
function isResolvedPhase(phase: PhaseDescriptor | null): boolean {
  return phase !== null && phase.status !== 'pending' && phase.status !== 'in_progress'
}

function addressedPhaseOf(trip: Trip | null, phaseEventId: string): PhaseDescriptor | null {
  return trip?.phases.find((phase) => phase.phase_event_id === phaseEventId) ?? null
}

const DEFAULT_CONFLICT_MESSAGE = 'Trip state changed unexpectedly. Please retry from the trip screen.'
const DEFAULT_TERMINAL_MESSAGE = 'Could not submit. Please try again.'

async function runSubmission(request: PhaseSubmissionRequest): Promise<PhaseSubmissionOutcome> {
  const { tripId, phaseEventId, phaseType, evidence, idempotencyKey } = request
  const position = await resolvePosition(request.position)

  try {
    const result = await submitPhase(tripId, phaseEventId, phaseType, evidence, idempotencyKey, position)
    if (result.trip !== null && result.trip.status === 'exception_hold') {
      return { kind: 'hold', trip: result.trip }
    }
    return { kind: 'recorded', trip: result.trip, addressedPhase: addressedPhaseOf(result.trip, phaseEventId) }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // No ordinal TripStatus left to compare against — `active` covers the whole
      // multi-stop middle. A duplicate submit of an already-resolved phase also 409s, so
      // the only way to tell "this already succeeded" apart from a genuine conflict is to
      // refetch and read the ADDRESSED PHASE'S OWN status off the returned plan.
      let fetched: Trip | null = null
      try {
        fetched = await request.refetchTrip()
      } catch (refetchErr: unknown) {
        // Offline right after a 409 — we cannot tell replay from conflict, and guessing
        // "already recorded" would tell a driver their evidence landed when it may not
        // have. Report the conflict so the notice stays up and the phase rolls back.
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
      // The server's own 409 detail, not a hardcoded sentence: every 409 the backend
      // raises describes its actual cause (an unresolved earlier phase, or a trip that
      // isn't due until a stated date), and a fixed string discarded all of it.
      return { kind: 'conflict', message: err.message || DEFAULT_CONFLICT_MESSAGE }
    }

    if (isQueueableFailure(err)) {
      // Network error, 5xx, or a status-0 timeout — queue for retry once connectivity or
      // the server recovers. The position goes WITH the entry so a replay hours later
      // still reports where the driver was when they swiped.
      request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position)
      return { kind: 'queued' }
    }

    // Terminal: a client-side 4xx, or a local validation Error thrown by submitPhase
    // before any network call. Neither can succeed on retry, so queuing it would hand
    // the driver a "stored on this device" receipt for evidence that will never land.
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

  // Runs last, and outside the store update, so a throwing subscriber can never leave a
  // phase stuck in `inFlight` forever.
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
  // Attached before the dedupe check so an ignored request can never leave an unhandled
  // rejection behind.
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
