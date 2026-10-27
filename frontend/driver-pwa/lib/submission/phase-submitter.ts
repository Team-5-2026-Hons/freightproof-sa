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

const POSITION_CAPTURE_BUDGET_MS = 12_000

const POSITION_FALLBACK_MAX_AGE_MS = 60_000

interface TimestampedFix {
  position: DriverPosition
  capturedAtMs: number
  generation: number
}

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

async function resolvePosition(pending: Promise<DriverPosition | null>, generation: number): Promise<DriverPosition | null> {
  const captured = await new Promise<DriverPosition | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), POSITION_CAPTURE_BUDGET_MS)
    void pending.then(
      (position) => { clearTimeout(timer); resolve(position) },
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
  void pending.then((late) => { if (late !== null) rememberFix(late, generation) }, () => {})
  return recentFix(generation)
}

/**
 * What actually became of a submission. The caller turns these into draft clearing,
 * trip reconciliation, toasts and navigation — this module never renders anything and
 * never routes, so it stays testable without React.
 */
export type PhaseSubmissionOutcome =
  | { kind: 'recorded'; trip: Trip | null; addressedPhase: PhaseDescriptor | null }
  | { kind: 'hold'; trip: Trip }
  | { kind: 'queued' }
  | { kind: 'conflict'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'retained'; message: string; persisted: boolean; handedOver: boolean }

/** A terminal failure the driver has not yet acknowledged. Surfaced by OfflineBanner. */
export interface PhaseSubmissionFailure {
  phaseEventId: string
  phaseType: PhaseType
  message: string
}

export interface PhaseSubmissionStoreState {
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
  idempotencyKey: string
  position: Promise<DriverPosition | null>
  driverCapturedAt: string
  acknowledgement?: LocationWarningAcknowledgement | null
  custody?: CustodyStamp
  enqueuePhase: EnqueuePhase
  /** Used ONLY to resolve a 409 — did an earlier attempt of this phase already land? */
  refetchTrip: () => Promise<Trip | null>
  /** Called exactly once, after the submission settles, from wherever the driver now is. */
  onOutcome: (outcome: PhaseSubmissionOutcome) => void
}

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

const running = new Set<string>()

function isResolvedPhase(phase: PhaseDescriptor | null): boolean {
  return phase !== null && phase.status !== 'pending' && phase.status !== 'in_progress'
}

function addressedPhaseOf(trip: Trip | null, phaseEventId: string): PhaseDescriptor | null {
  return trip?.phases.find((phase) => phase.phase_event_id === phaseEventId) ?? null
}

const DEFAULT_CONFLICT_MESSAGE = 'Trip state changed unexpectedly. Please retry from the trip screen.'
const DEFAULT_TERMINAL_MESSAGE = 'Could not submit. Please try again.'
const QUEUE_STORAGE_FAILED_MESSAGE = 'Couldn’t save on this phone. Storage is full or unavailable. Try again.'

async function runSubmission(request: PhaseSubmissionRequest, generation: number): Promise<PhaseSubmissionOutcome> {
  const { tripId, phaseEventId, phaseType, evidence, idempotencyKey, driverCapturedAt, acknowledgement = null } = request
  const custody = request.custody ?? captureCustody(tripId)
  const position = await resolvePosition(request.position, generation)
  const retainAfterAccountChange = (): PhaseSubmissionOutcome => ({
    kind: 'retained', message: 'Account changed; captured work is retained.', handedOver: false,
    persisted: request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt, acknowledgement, custody, null, idempotencyKey),
  })
  const retainOverridden = (attention: RetainedAttention): PhaseSubmissionOutcome => ({
    kind: 'retained', message: attention.reason, handedOver: false,
    persisted: request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt, acknowledgement, custody, attention, idempotencyKey),
  })
  const overriddenAttention = (): RetainedAttention => retainedAttention('PHASE_OVERRIDDEN', 409, PHASE_OVERRIDDEN_REASON)
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
    if (err instanceof ApiError && err.code !== undefined) {
      const failure = classifyLiveWriteFailure(err)
      if (failure.kind === 'duplicate') {
        return { kind: 'recorded', trip: null, addressedPhase: null }
      }
      if (failure.kind === 'retain' && isPhaseOverridden(failure.attention)) {
        return retainOverridden(failure.attention)
      }
      if (failure.kind === 'retain' && isCustodyConflict(failure.attention)) {
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
      let fetched: Trip | null = null
      try {
        fetched = await request.refetchTrip()
      } catch (refetchErr: unknown) {
        if (actorGeneration() !== generation) return retainAfterAccountChange()
        console.error('phase-submitter: could not refetch the trip to resolve a 409', refetchErr)
        return { kind: 'conflict', message: err.message || DEFAULT_CONFLICT_MESSAGE }
      }

      if (actorGeneration() !== generation) return retainAfterAccountChange()

      const addressedPhase = addressedPhaseOf(fetched, phaseEventId)
      if (addressedPhase?.status === 'overridden') return retainOverridden(overriddenAttention())
      if (fetched !== null && fetched.status === 'exception_hold') {
        return { kind: 'hold', trip: fetched }
      }
      if (isResolvedPhase(addressedPhase)) {
        return { kind: 'recorded', trip: fetched, addressedPhase }
      }
      return { kind: 'conflict', message: err.message || DEFAULT_CONFLICT_MESSAGE }
    }

    if (isQueueableFailure(err)) {
      const persisted = request.enqueuePhase(tripId, phaseEventId, phaseType, evidence, position, driverCapturedAt, acknowledgement, custody, null, idempotencyKey)
      if (!persisted) return { kind: 'failed', message: QUEUE_STORAGE_FAILED_MESSAGE }
      return { kind: 'queued' }
    }

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

  publish({ inFlight, failures })

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
  const guardedRequest: PhaseSubmissionRequest = {
    ...request,
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
      console.error('phase-submitter: submission threw unexpectedly', err)
      settle(guardedRequest, {
        kind: 'failed',
        message: err instanceof Error ? err.message : DEFAULT_TERMINAL_MESSAGE,
      }, scope)
    },
  )

  return true
}
