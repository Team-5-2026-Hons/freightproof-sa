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
import { actorGeneration, captureCustody, isCurrentTripCustody, onCustodyActorChange, onTripCustodyChange, type CustodyStamp } from '@/lib/session/custody-context'
import {
  classifyLiveWriteFailure, isCustodyConflict, isPhaseOverridden, PHASE_OVERRIDDEN_REASON, retainedAttention,
  type RetainedAttention,
} from '@/lib/offline/live-write-conflict'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type { PhaseEvidence } from '@/lib/types/evidence-draft'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'

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
  generation: number
}

// The most recent fix any submission managed to take. Module scope for the same reason
// everything else here is: it has to survive the screen that captured it.
let lastKnownFix: TimestampedFix | null = null

function rememberFix(position: DriverPosition, generation: number): void {
  if (actorGeneration() !== generation) return
  lastKnownFix = { position, capturedAtMs: Date.now(), generation }
}

function recentFix(generation: number): DriverPosition | null {
  if (lastKnownFix === null || lastKnownFix.generation !== generation || actorGeneration() !== generation) return null
  return Date.now() - lastKnownFix.capturedAtMs <= POSITION_FALLBACK_MAX_AGE_MS
    ? lastKnownFix.position
    : null
}

// Resolves null rather than rejecting or hanging: a failed fix is normal (a warehouse
// roof, a denied permission) and must never be the reason evidence goes unrecorded.
async function resolvePosition(pending: Promise<DriverPosition | null>, generation: number): Promise<DriverPosition | null> {
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
    rememberFix(captured, generation)
    return captured
  }
  // A capture that lands AFTER the budget still tells the next submission where the
  // driver is, so the cache is fed even when this submission could not wait for it.
  void pending.then((late) => { if (late !== null) rememberFix(late, generation) }, () => {})
  return recentFix(generation)
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
  /**
   * The server refused this capture because custody moved on (TRIP_HANDED_OVER,
   * CUSTODY_CONTEXT_CHANGED/REQUIRED). The evidence is kept for review in the offline queue
   * (`persisted`), never discarded and never resent live. `handedOver` asks the caller to
   * drop the trip as working context.
   */
  | { kind: 'retained'; message: string; persisted: boolean; handedOver: boolean }

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
  acknowledgement?: LocationWarningAcknowledgement | null,
  custody?: CustodyStamp,
  attention?: RetainedAttention | null,
  originalIdempotencyKey?: string,
) => boolean

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
  /**
   * The instant the caller (the step controller) considers this attempt
   * submitted — generated once per logical attempt, same as idempotencyKey, and reused
   * across any retry of that attempt so a replay from the offline queue still reports the
   * ORIGINAL swipe instant, never a retry's own clock.
   */
  driverCapturedAt: string
  /** Driver context from a reliable preview warning; never an assessment verdict. */
  acknowledgement?: LocationWarningAcknowledgement | null
  /**
   * Who swiped and in which custody period. Optional for callers; when absent it is
   * taken synchronously in startPhaseSubmission, i.e. at the swipe, never at send time.
   */
  custody?: CustodyStamp
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

interface SubmissionScope {
  key: string
  generation: number
  tripId: string
  phaseEventId: string
  custody: CustodyStamp
}

interface ScopedSubmissionState {
  inFlight: readonly SubmissionScope[]
  failures: readonly { scope: SubmissionScope; failure: PhaseSubmissionFailure }[]
}

const EMPTY_STATE: PhaseSubmissionStoreState = { inFlight: [], failures: [] }
let state: ScopedSubmissionState = { inFlight: [], failures: [] }
let snapshot: PhaseSubmissionStoreState = EMPTY_STATE

function isCurrentScope(scope: SubmissionScope): boolean {
  return scope.generation === actorGeneration()
    && isCurrentTripCustody(scope.tripId, scope.custody)
}

function publish(next: ScopedSubmissionState): void {
  state = {
    // Keep other trips' attempts: switching the selected trip hides them, but
    // returning must recover their markers while their requests are still running.
    inFlight: next.inFlight.filter(scope => scope.generation === actorGeneration()),
    failures: next.failures.filter(({ scope }) => scope.generation === actorGeneration()),
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: StoreListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): PhaseSubmissionStoreState {
  const inFlight = state.inFlight.filter(isCurrentScope).map(scope => scope.phaseEventId)
  const failures = state.failures.filter(({ scope }) => isCurrentScope(scope)).map(({ failure }) => failure)
  // Custody can change without an account change. Filter on read, but keep the
  // reference stable while the visible values are unchanged for useSyncExternalStore.
  if (inFlight.length === 0 && failures.length === 0) snapshot = EMPTY_STATE
  else if (inFlight.length !== snapshot.inFlight.length || failures.length !== snapshot.failures.length
    || inFlight.some((id, index) => id !== snapshot.inFlight[index])
    || failures.some((failure, index) => failure !== snapshot.failures[index])) {
    snapshot = { inFlight, failures }
  }
  return snapshot
}

onCustodyActorChange(() => {
  if (state.inFlight.some(scope => scope.generation !== actorGeneration())
    || state.failures.some(({ scope }) => scope.generation !== actorGeneration())) publish(state)
})

onTripCustodyChange(() => { listeners.forEach(listener => listener()) })

// A module constant, so useSyncExternalStore's hydration snapshot is referentially stable.
function getServerSnapshot(): PhaseSubmissionStoreState {
  return EMPTY_STATE
}

/** Live view of what is submitting and what has failed. Safe to mount many times. */
export function usePhaseSubmissions(): PhaseSubmissionStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Acknowledge one terminal failure notice. */
export function dismissPhaseSubmissionFailure(phaseEventId: string): void {
  publish({
    ...state,
    failures: state.failures.filter(({ failure }) => failure.phaseEventId !== phaseEventId),
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
  publish({ inFlight: [], failures: [] })
}

// ─── Submission ────────────────────────────────────────────────────────────────

// Account/custody-scoped phase attempts currently running. Guard against a double submit: the
// optimistic advance in TripContext already stops the driver re-entering a step whose
// submission is in flight, but a stale tab or a deep link should not be able to fire a
// second POST for the same ledger row either.
const running = new Set<string>()

// Mirrors lib/phase/derive.ts's RESOLVED_STATUSES (private to that module): completed,
// exception and overridden all mean the ledger is done with this row. Only pending and
// in_progress leave room for a genuinely fresh attempt. (Overridden is handled before this is
// asked: it is resolved, but not by the driver's capture.)
function isResolvedPhase(phase: PhaseDescriptor | null): boolean {
  return phase !== null && phase.status !== 'pending' && phase.status !== 'in_progress'
}

function addressedPhaseOf(trip: Trip | null, phaseEventId: string): PhaseDescriptor | null {
  return trip?.phases.find((phase) => phase.phase_event_id === phaseEventId) ?? null
}

const DEFAULT_CONFLICT_MESSAGE = 'Trip state changed unexpectedly. Please retry from the trip screen.'
const DEFAULT_TERMINAL_MESSAGE = 'Could not submit. Please try again.'
// Same wording as the checkpoint screen's storage failure, so the driver hears one message for one cause.
const QUEUE_STORAGE_FAILED_MESSAGE = 'Couldn’t save on this phone. Storage is full or unavailable. Try again.'

async function runSubmission(request: PhaseSubmissionRequest, generation: number): Promise<PhaseSubmissionOutcome> {
  const { tripId, phaseEventId, phaseType, evidence, idempotencyKey, driverCapturedAt, acknowledgement = null } = request
  const custody = request.custody ?? captureCustody(tripId)
  const position = await resolvePosition(request.position, generation)
  const retainAfterAccountChange = (): PhaseSubmissionOutcome => ({
    kind: 'retained', message: 'Account changed; captured work is retained.', handedOver: false,
    persisted: request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt, acknowledgement, custody, null, idempotencyKey),
  })
  // Dispatch closed this phase, so the capture never reached the ledger. Kept on the phone for
  // the driver, never reported as recorded: a "recorded" here would clear the draft and the
  // evidence would be gone. Not custody-related, so it is not offered as late evidence.
  const retainOverridden = (attention: RetainedAttention): PhaseSubmissionOutcome => ({
    kind: 'retained', message: attention.reason, handedOver: false,
    persisted: request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt, acknowledgement, custody, attention, idempotencyKey),
  })
  // For an older backend that answers 200, or an uncoded 409, instead of the coded refusal.
  const overriddenAttention = (): RetainedAttention => retainedAttention('PHASE_OVERRIDDEN', 409, PHASE_OVERRIDDEN_REASON)
  // The GPS promise belongs to the account that swiped, including an A→B→A return.
  if (actorGeneration() !== generation) return retainAfterAccountChange()

  try {
    const result = await submitPhase(
      tripId, phaseEventId, phaseType, evidence, idempotencyKey, position, driverCapturedAt, acknowledgement,
      custody.custodySequence,
    )
    if (actorGeneration() !== generation) return retainAfterAccountChange()
    const addressedPhase = addressedPhaseOf(result.trip, phaseEventId)
    if (addressedPhase?.status === 'overridden') return retainOverridden(overriddenAttention())
    if (result.trip !== null && result.trip.status === 'exception_hold') {
      return { kind: 'hold', trip: result.trip }
    }
    return { kind: 'recorded', trip: result.trip, addressedPhase }
  } catch (err) {
    if (actorGeneration() !== generation) return retainAfterAccountChange()
    // Coded answers come first: they are decided by their code, not by "409 means
    // maybe a duplicate". Uncoded 409s keep the existing refetch-and-read-the-plan check.
    if (err instanceof ApiError && err.code !== undefined) {
      const failure = classifyLiveWriteFailure(err)
      if (failure.kind === 'duplicate') {
        // A proven actor-bound replay of this exact submission. No trip comes back — a
        // former driver is not shown current detail — so the phase is reported recorded.
        return { kind: 'recorded', trip: null, addressedPhase: null }
      }
      if (failure.kind === 'retain' && isPhaseOverridden(failure.attention)) {
        return retainOverridden(failure.attention)
      }
      if (failure.kind === 'retain' && isCustodyConflict(failure.attention)) {
        // Kept for review under its ORIGINAL custody period, so it can go as late
        // evidence; never resent live and never lost with the rolled-back step.
        const persisted = request.enqueuePhase(
          tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt, acknowledgement,
          custody, failure.attention, idempotencyKey,
        )
        return {
          kind: 'retained',
          message: failure.attention.reason,
          persisted,
          handedOver: failure.attention.code === 'TRIP_HANDED_OVER',
        }
      }
    }

    if (err instanceof ApiError && err.status === 409) {
      // No ordinal TripStatus left to compare against — `active` covers the whole
      // multi-stop middle. A duplicate submit of an already-resolved phase also 409s, so
      // the only way to tell "this already succeeded" apart from a genuine conflict is to
      // refetch and read the ADDRESSED PHASE'S OWN status off the returned plan.
      let fetched: Trip | null = null
      try {
        fetched = await request.refetchTrip()
      } catch (refetchErr: unknown) {
        if (actorGeneration() !== generation) return retainAfterAccountChange()
        // Offline right after a 409 — we cannot tell replay from conflict, and guessing
        // "already recorded" would tell a driver their evidence landed when it may not
        // have. Report the conflict so the notice stays up and the phase rolls back.
        console.error('phase-submitter: could not refetch the trip to resolve a 409', refetchErr)
        return { kind: 'conflict', message: err.message || DEFAULT_CONFLICT_MESSAGE }
      }

      if (actorGeneration() !== generation) return retainAfterAccountChange()

      // Read before the hold check and before "resolved": an overridden row IS resolved, but not
      // by this capture, so treating it as an earlier success would discard the evidence.
      const addressedPhase = addressedPhaseOf(fetched, phaseEventId)
      if (addressedPhase?.status === 'overridden') return retainOverridden(overriddenAttention())
      if (fetched !== null && fetched.status === 'exception_hold') {
        return { kind: 'hold', trip: fetched }
      }
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
      // the server recovers. The position and the capture instant go WITH the entry so a
      // replay hours later still reports where — and when — the driver actually swiped.
      const persisted = request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt, acknowledgement, custody, null, idempotencyKey)
      // The phone refused to store it (storage full or disabled): no replay is scheduled, so this
      // is not "queued". 'failed' rolls the optimistic advance back and keeps the draft, so the
      // driver retries from the same step instead of trusting a sync that will never happen.
      if (!persisted) return { kind: 'failed', message: QUEUE_STORAGE_FAILED_MESSAGE }
      return { kind: 'queued' }
    }

    // Terminal: a client-side 4xx, or a local validation Error thrown by submitPhase
    // before any network call. Neither can succeed on retry, so queuing it would hand
    // the driver a "stored on this device" receipt for evidence that will never land.
    return { kind: 'failed', message: err instanceof Error ? err.message : DEFAULT_TERMINAL_MESSAGE }
  }
}

function settle(request: PhaseSubmissionRequest, outcome: PhaseSubmissionOutcome, scope: SubmissionScope): void {
  running.delete(scope.key)

  const inFlight = state.inFlight.filter((attempt) => attempt.key !== scope.key)
  const isTerminal = outcome.kind === 'failed' || outcome.kind === 'conflict' || outcome.kind === 'retained'
  const failures = isTerminal
    ? [
        ...state.failures.filter((entry) => entry.scope.key !== scope.key),
        { scope, failure: { phaseEventId: request.phaseEventId, phaseType: request.phaseType, message: outcome.message } },
      ]
    : state.failures.filter((entry) => entry.scope.key !== scope.key)

  // A late period-0 completion owns only its attempt, never period 2's marker or notice.
  publish({ inFlight, failures })

  // Runs last, and outside the store update, so a throwing subscriber can never leave a
  // phase stuck in `inFlight` forever.
  request.onOutcome(outcome)
}

/**
 * Hand a phase submission to the background and return immediately.
 *
 * @returns false when a submission for this phase in the same account/custody period is already running, in which
 * case nothing new was started — the caller should still navigate, because the driver's
 * evidence is already on its way.
 */
export function startPhaseSubmission(request: PhaseSubmissionRequest): boolean {
  const generation = actorGeneration()
  const custody = request.custody ?? captureCustody(request.tripId)
  // Attached before the dedupe check so an ignored request can never leave an unhandled
  // rejection behind.
  const guardedRequest: PhaseSubmissionRequest = {
    ...request,
    // Stamped HERE, synchronously at the swipe — not after the GPS wait — so the period
    // recorded is the one the driver acted in.
    custody,
    position: request.position.catch((err: unknown) => {
      console.error('phase-submitter: position capture rejected', err)
      return null
    }),
  }

  const runningKey = JSON.stringify([generation, request.tripId, custody.actorId, custody.custodySequence ?? 0, request.phaseEventId])
  const scope: SubmissionScope = { key: runningKey, generation, tripId: request.tripId, phaseEventId: request.phaseEventId, custody }
  if (running.has(runningKey)) return false
  running.add(runningKey)
  publish({
    inFlight: [...state.inFlight, scope],
    failures: state.failures.filter((entry) => entry.scope.key !== runningKey),
  })

  void runSubmission(guardedRequest, generation).then(
    (outcome) => settle(guardedRequest, outcome, scope),
    (err: unknown) => {
      // runSubmission catches everything it expects; reaching here means a defect in
      // this module rather than a submission failure. Never swallow it, and never leave
      // the phase marked in-flight.
      console.error('phase-submitter: submission threw unexpectedly', err)
      settle(guardedRequest, {
        kind: 'failed',
        message: err instanceof Error ? err.message : DEFAULT_TERMINAL_MESSAGE,
      }, scope)
    },
  )

  return true
}
