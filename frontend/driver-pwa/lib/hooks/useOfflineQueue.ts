'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { submitPhase } from '@/lib/api/phases'
import { raiseException, type RaiseExceptionBody } from '@/lib/api/exceptions'
import { submitCheckpoint, type CheckpointEvidence } from '@/lib/api/checkpoints'
import { recordLocations, type LocationPingBody } from '@/lib/api/locations'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import type { PhaseType } from '@shared/lib/types/phase'
import type { PhaseEvidence } from '@/lib/types/evidence-draft'
import { captureActorLease, isActorLeaseCurrent, captureCustody, currentActorId, onCustodyActorChange, type CustodyStamp } from '@/lib/session/custody-context'
import {
  ExceptionStoreError,
  getExceptionEnvelope,
  listExceptionEnvelopes,
  quarantineUnattributedEnvelopes,
  resetExceptionToPending,
  saveExceptionEnvelope,
  type ExceptionEnvelope,
  type ExceptionPhotoRecord,
  type ExceptionReportBody,
} from '@/lib/offline/exception-store'
import type { ExceptionSendOutcome } from '@/lib/offline/exception-sync'
import {
  dataUrlToBlob, sendExceptionReport, tryReportLock, waitReportLock,
} from '@/lib/offline/exception-sync'
import { migrateLegacyExceptionEntries } from '@/lib/offline/legacy-exception-migration'
import { classifyLiveWriteFailure, isCustodyConflict, isPhaseOverridden, type RetainedAttention } from '@/lib/offline/live-write-conflict'
import {
  entryStatus,
  isLegacyException,
  isSendableEntry,
  loadQueue,
  migrateQueueForCustody,
  saveQueue,
  updateQueue,
  type CheckpointQueueEntry,
  type LocationQueueEntry,
  type PhaseQueueEntry,
  type SendableQueueEntry,
} from '@/lib/offline/queue-storage'

/** A photo captured for an exception that could not be uploaded before it was queued. */
export interface QueuedExceptionPhoto {
  dataUrl: string
  capturedAt: string
}

/**
 * What made it to disk. `persisted: false` means the report was NOT stored and will
 * never flush; `photoCount` is how many photos were stored with it.
 */
export interface EnqueueExceptionResult {
  persisted: boolean
  photoCount: number
}

const UNREADABLE_PHOTO_REASON = 'photo could not be read'

/** A report the driver is composing, with its photos still as data URLs. */
export interface ExceptionDraft {
  tripId: string
  clientReportId: string
  body: ExceptionReportBody
  photos: Array<{ id: string; dataUrl: string; capturedAt: string }>
}

export type ExceptionSubmitOutcome =
  | { kind: 'acknowledged' }
  | { kind: 'saved-for-later' }
  | { kind: 'not-saved'; photoCount: number }
  | { kind: 'rejected'; reason: string; photoIndex: number | null }

function isSendableNow(entry: SendableQueueEntry, actorId: string | null): boolean {
  return entryStatus(entry) === 'pending' && entry.actorId != null && entry.actorId === actorId
}

async function sendEntry(entry: SendableQueueEntry): Promise<void> {
  const custodySequence = entry.custodySequence ?? null
  if (entry.kind === 'phase') {
    await submitPhase(
      entry.tripId, entry.phaseEventId, entry.phaseType, entry.evidence,
      entry.idempotencyKey, entry.position ?? null, entry.driverCapturedAt, entry.acknowledgement ?? null,
      custodySequence,
    )
  } else if (entry.kind === 'checkpoint') {
    await submitCheckpoint(entry.tripId, { ...entry.evidence, custodySequence })
  } else {
    await recordLocations(entry.tripId, entry.pings, custodySequence)
  }
}

function reportRequestBody(envelope: ExceptionEnvelope, artifactIds: string[]): RaiseExceptionBody {
  return {
    ...envelope.body,
    ...(artifactIds.length > 0
      ? { supporting_artifact_ids: artifactIds, supporting_artifact_id: artifactIds[0] }
      : {}),
  }
}

let flushingGlobal = false
let rateLimitRetryTimer: ReturnType<typeof setTimeout> | null = null
let rateLimitRetryAt = 0

function clearRateLimitRetry(): void {
  if (rateLimitRetryTimer !== null) clearTimeout(rateLimitRetryTimer)
  rateLimitRetryTimer = null
  rateLimitRetryAt = 0
}

function scheduleRateLimitRetry(delayMs: number): void {
  const retryAt = Date.now() + delayMs
  if (rateLimitRetryTimer !== null && rateLimitRetryAt <= retryAt) return
  clearRateLimitRetry()
  rateLimitRetryAt = retryAt
  rateLimitRetryTimer = setTimeout(() => {
    rateLimitRetryTimer = null
    rateLimitRetryAt = 0
    void flushQueue()
  }, delayMs)
}

interface QueueStoreState {
  length: number
  attentionCount: number
  heldForOtherAccounts: number
}

type StoreListener = () => void

const storeListeners = new Set<StoreListener>()

let pendingEnvelopeCount = 0
let attentionEnvelopeCount = 0
let otherAccountEnvelopeCount = 0
let storeEpoch = 0

interface LocalQueueCounts {
  pending: number
  attention: number
  otherAccounts: number
}

function localQueueCounts(): LocalQueueCounts {
  const actorId = currentActorId()
  const counts: LocalQueueCounts = { pending: 0, attention: 0, otherAccounts: 0 }
  for (const entry of loadQueue()) {
    const status = entryStatus(entry)
    if (status === 'quarantined') counts.attention += 1
    else if (isLegacyException(entry)) counts.pending += 1
    else if (isSendableEntry(entry) && entry.actorId !== actorId) counts.otherAccounts += 1
    else if (status === 'needs-attention') counts.attention += 1
    else counts.pending += 1
  }
  return counts
}

const EMPTY_STORE_STATE: QueueStoreState = { length: 0, attentionCount: 0, heldForOtherAccounts: 0 }

let storeState: QueueStoreState = EMPTY_STORE_STATE

const SERVER_STORE_SNAPSHOT: QueueStoreState = EMPTY_STORE_STATE

function publishStoreState(patch: Partial<QueueStoreState>): void {
  storeState = { ...storeState, ...patch }
  storeListeners.forEach((listener) => listener())
}

function publishCounts(patch: Partial<QueueStoreState> = {}): void {
  const local = localQueueCounts()
  publishStoreState({
    length: local.pending + pendingEnvelopeCount,
    attentionCount: local.attention + attentionEnvelopeCount,
    heldForOtherAccounts: local.otherAccounts + otherAccountEnvelopeCount,
    ...patch,
  })
}

async function refreshExceptionCounts(): Promise<void> {
  const epoch = storeEpoch
  try {
    const envelopes = await listExceptionEnvelopes()
    if (epoch !== storeEpoch) return
    const actorId = currentActorId()
    let pending = 0
    let attention = 0
    let otherAccounts = 0
    for (const envelope of envelopes) {
      if (envelope.status === 'quarantined') attention += 1
      else if (envelope.actorId != null && envelope.actorId !== actorId) otherAccounts += 1
      else if (envelope.status === 'needs-attention') attention += 1
      else pending += 1
    }
    pendingEnvelopeCount = pending
    attentionEnvelopeCount = attention
    otherAccountEnvelopeCount = otherAccounts
  } catch (err) {
    if (epoch !== storeEpoch) return
    if (!(err instanceof ExceptionStoreError) || err.failure !== 'unavailable') {
      console.warn('useOfflineQueue: could not read exception reports from IndexedDB', err)
    }
  }
  publishCounts()
}

function subscribeToStore(listener: StoreListener): () => void {
  storeListeners.add(listener)
  return () => storeListeners.delete(listener)
}

function getStoreSnapshot(): QueueStoreState {
  return storeState
}

function getServerStoreSnapshot(): QueueStoreState {
  return SERVER_STORE_SNAPSHOT
}

/**
 * Re-reads every count. For callers that change retained items outside the flush (the review
 * screen, the late-evidence sender) so every mounted banner sees the change.
 */
export function refreshOfflineQueueCounts(): Promise<void> {
  return refreshExceptionCounts()
}

if (typeof window !== 'undefined') {
  migrateQueueForCustody()
  void refreshExceptionCounts()
  onCustodyActorChange(() => { void flushQueue() })
}

/**
 * Test-only reset for the module-scope store — `localStorage.clear()` alone can't reset
 * the in-memory counts. Not part of the public hook API.
 */
export function __resetOfflineQueueStoreForTests(): void {
  flushingGlobal = false
  clearRateLimitRetry()
  storeEpoch += 1
  pendingEnvelopeCount = 0
  attentionEnvelopeCount = 0
  otherAccountEnvelopeCount = 0
  storeState = { ...EMPTY_STORE_STATE, length: loadQueue().length }
}

async function migrateForCustody(): Promise<void> {
  migrateQueueForCustody()
  try {
    await quarantineUnattributedEnvelopes()
  } catch (err) {
    if (!(err instanceof ExceptionStoreError) || err.failure !== 'unavailable') {
      console.warn('useOfflineQueue: could not quarantine unattributed exception reports', err)
    }
  }
}

async function migrateLegacyExceptions(): Promise<void> {
  const { failed } = await migrateLegacyExceptionEntries({
    readLegacy: () => loadQueue().filter(isLegacyException),
    dropLegacy: (ids) => {
      const dropped = new Set(ids)
      return saveQueue(loadQueue().filter((entry) => !dropped.has(entry.id)))
    },
  })
  if (failed > 0) console.warn(`useOfflineQueue: ${failed} legacy exception report(s) left in localStorage`)
}

async function flushExceptionEnvelopes(): Promise<void> {
  const lease = captureActorLease()
  let envelopes: ExceptionEnvelope[]
  try {
    envelopes = await listExceptionEnvelopes()
  } catch (err) {
    if (!(err instanceof ExceptionStoreError) || err.failure !== 'unavailable') {
      console.warn('useOfflineQueue: could not list exception reports', err)
    }
    return
  }
  const actorId = currentActorId()
  for (const listed of envelopes) {
    if (lease === null || !isActorLeaseCurrent(lease)) break
    if (listed.status !== 'pending') continue
    if (listed.actorId == null || listed.actorId !== actorId) continue
    const release = tryReportLock(listed.clientReportId)
    if (!release) continue
    try {
      let envelope: ExceptionEnvelope | null
      try {
        envelope = await getExceptionEnvelope(listed.clientReportId)
      } catch (err) {
        console.warn('useOfflineQueue: could not re-read exception report', err)
        continue
      }
      if (!envelope || envelope.status !== 'pending') continue
      const stored = envelope
      const outcome = await sendExceptionReport(stored, {
        durable: true,
        lockHeld: true,
        post: (artifactIds) => raiseException(stored.tripId, reportRequestBody(stored, artifactIds)),
      })
      if (outcome.kind === 'transient' && outcome.retryAfterMs !== null) {
        scheduleRateLimitRetry(outcome.retryAfterMs)
      }
    } finally {
      release()
    }
  }
}

async function flushQueue(): Promise<void> {
  if (flushingGlobal) return
  const lease = captureActorLease()
  flushingGlobal = true
  try {
    await migrateForCustody()
    await migrateLegacyExceptions()
    if (lease === null || !isActorLeaseCurrent(lease)) return
    await flushExceptionEnvelopes()

    const queue = loadQueue()
    const actorId = currentActorId()
    const disposedIds = new Set<string>()
    const retained = new Map<string, RetainedAttention>()

    const stalledTripIds = new Set<string>()

    for (const entry of queue) {
      if (!isActorLeaseCurrent(lease)) break
      if (!isSendableEntry(entry) || !isSendableNow(entry, actorId)) continue
      if (entry.kind === 'phase' && stalledTripIds.has(entry.tripId)) continue

      try {
        await sendEntry(entry)
        disposedIds.add(entry.id)
      } catch (err) {
        const failure = classifyLiveWriteFailure(err)
        if (failure.kind === 'duplicate') {
          disposedIds.add(entry.id)
          continue
        }
        if (failure.kind === 'retain') {
          retained.set(entry.id, failure.attention)
          console.warn(`useOfflineQueue: retained refused entry "${entry.id}" (${failure.attention.status} ${failure.attention.code ?? 'uncoded'})`)
        } else if (failure.retryAfterMs !== null) {
          scheduleRateLimitRetry(failure.retryAfterMs)
        }
        const overriddenByDispatch = failure.kind === 'retain' && isPhaseOverridden(failure.attention)
        if (entry.kind === 'phase' && !overriddenByDispatch) stalledTripIds.add(entry.tripId)
      }
    }

    if (disposedIds.size > 0 || retained.size > 0) {
      updateQueue((entries) => entries
        .filter((entry) => !disposedIds.has(entry.id))
        .map((entry) => {
          const attention = retained.get(entry.id)
          return attention !== undefined && isSendableEntry(entry)
            ? { ...entry, status: 'needs-attention' as const, attention }
            : entry
        }))
    }
    await refreshExceptionCounts()
    if (storeState.length === 0) clearRateLimitRetry()
  } finally {
    flushingGlobal = false
  }
}

async function retryAttention(): Promise<void> {
  const actorId = currentActorId()
  try {
    const envelopes = await listExceptionEnvelopes()
    for (const envelope of envelopes) {
      if (envelope.status !== 'needs-attention' || envelope.actorId !== actorId) continue
      if (envelope.attention && (isCustodyConflict(envelope.attention) || isPhaseOverridden(envelope.attention))) continue
      await resetExceptionToPending(envelope.clientReportId)
    }
  } catch (err) {
    console.warn('useOfflineQueue: could not reset reports for retry', err)
  }
  updateQueue((entries) => entries.map((entry) => (
    isSendableEntry(entry)
      && entry.status === 'needs-attention'
      && entry.actorId === actorId
      && !(entry.attention && (isCustodyConflict(entry.attention) || isPhaseOverridden(entry.attention)))
      ? { ...entry, status: 'pending' as const, attention: null }
      : entry
  )))
  await refreshExceptionCounts()
  await flushQueue()
}

function stampFor(tripId: string, custody: CustodyStamp | undefined): Pick<SendableQueueEntry, 'actorId' | 'custodySequence' | 'status'> {
  const stamp = custody ?? captureCustody(tripId)
  return { actorId: stamp.actorId, custodySequence: stamp.custodySequence, status: 'pending' }
}

export function useOfflineQueue() {
  const { length: queueLength, attentionCount } = useSyncExternalStore(
    subscribeToStore,
    getStoreSnapshot,
    getServerStoreSnapshot,
  )

  const enqueuePhase = useCallback(
    (
      tripId: string, phaseEventId: string, phaseType: PhaseType, evidence: PhaseEvidence,
      position: DriverPosition | null, driverCapturedAt: string,
      acknowledgement: LocationWarningAcknowledgement | null = null,
      custody?: CustodyStamp,
      attention: RetainedAttention | null = null,
      originalIdempotencyKey?: string,
    ): boolean => {
      const id = crypto.randomUUID()
      const entry: PhaseQueueEntry = {
        kind: 'phase', id, tripId, phaseEventId, phaseType, evidence, idempotencyKey: originalIdempotencyKey ?? id,
        position, driverCapturedAt, acknowledgement: acknowledgement ?? null,
        enqueuedAt: new Date().toISOString(),
        ...stampFor(tripId, custody),
        ...(attention !== null ? { status: 'needs-attention' as const, attention } : {}),
      }
      if (saveQueue([...loadQueue(), entry])) {
        publishCounts()
        return true
      }

      let persisted = false
      if ('linehaulPdfDataUrl' in evidence && evidence.linehaulPdfDataUrl) {
        persisted = saveQueue([...loadQueue(), { ...entry, evidence: { ...evidence, linehaulPdfDataUrl: null } }])
      }
      publishCounts()
      return persisted
    },
    [],
  )

  const enqueueException = useCallback(
    async (tripId: string, body: RaiseExceptionBody, photos: QueuedExceptionPhoto[] = []): Promise<EnqueueExceptionResult> => {
      const clientReportId = body.client_report_id ?? crypto.randomUUID()
      const now = new Date().toISOString()
      const stamp = captureCustody(tripId)
      const {
        supporting_artifact_id: knownArtifactId,
        supporting_artifact_ids: ignoredArtifactIds,
        ...reportBody
      } = body
      void ignoredArtifactIds
      try {
        const records: ExceptionPhotoRecord[] = photos.map((photo) => ({
          id: crypto.randomUUID(),
          blob: dataUrlToBlob(photo.dataUrl),
          capturedAt: photo.capturedAt,
          uploadedArtifactId: null,
        }))
        if (records.length === 0 && knownArtifactId) {
          records.push({ id: crypto.randomUUID(), blob: null, capturedAt: now, uploadedArtifactId: knownArtifactId })
        }
        const release = await waitReportLock(clientReportId)
        try {
          await saveExceptionEnvelope({
            clientReportId,
            tripId,
            body: {
              ...reportBody,
              client_report_id: clientReportId,
              ...(reportBody.custody_sequence === undefined && stamp.custodySequence !== null
                ? { custody_sequence: stamp.custodySequence }
                : {}),
            },
            photos: records,
            status: 'pending',
            attentionReason: null,
            attentionPhotoId: null,
            actorId: stamp.actorId,
            createdAt: now,
            updatedAt: now,
          })
        } finally {
          release()
        }
        await refreshExceptionCounts()
        return { persisted: true, photoCount: records.length }
      } catch (err) {
        console.warn('useOfflineQueue: exception report was not stored', err)
        return { persisted: false, photoCount: 0 }
      }
    },
    [],
  )

  const submitExceptionReport = useCallback(
    async (
      draft: ExceptionDraft,
      post: (artifactIds: string[]) => Promise<unknown>,
      onProgress?: (uploaded: number, total: number) => void,
    ): Promise<ExceptionSubmitOutcome> => {
      const lease = captureActorLease()
      const now = new Date().toISOString()
      const photos: ExceptionPhotoRecord[] = []
      for (const [index, photo] of draft.photos.entries()) {
        try {
          photos.push({
            id: photo.id,
            blob: dataUrlToBlob(photo.dataUrl),
            capturedAt: photo.capturedAt,
            uploadedArtifactId: null,
          })
        } catch (err) {
          console.warn('useOfflineQueue: exception photo could not be read', err)
          return { kind: 'rejected', reason: UNREADABLE_PHOTO_REASON, photoIndex: index }
        }
      }
      const stamp = captureCustody(draft.tripId)
      let envelope: ExceptionEnvelope = {
        clientReportId: draft.clientReportId,
        tripId: draft.tripId,
        body: draft.body.custody_sequence === undefined && stamp.custodySequence !== null
          ? { ...draft.body, custody_sequence: stamp.custodySequence }
          : draft.body,
        photos,
        status: 'pending',
        attentionReason: null,
        attentionPhotoId: null,
        actorId: stamp.actorId,
        createdAt: now,
        updatedAt: now,
      }

      const release = await waitReportLock(draft.clientReportId)
      let durable = true
      let outcome: ExceptionSendOutcome
      try {
        try {
          await saveExceptionEnvelope(envelope)
          envelope = (await getExceptionEnvelope(draft.clientReportId)) ?? envelope
        } catch (err) {
          durable = false
          console.warn('useOfflineQueue: exception report could not be stored; sending without a saved copy', err)
        }
        outcome = lease !== null && isActorLeaseCurrent(lease)
          ? await sendExceptionReport(envelope, { durable, lockHeld: true, post, onProgress })
          : { kind: 'not-yours' }
      } finally {
        release()
      }
      await refreshExceptionCounts()

      switch (outcome.kind) {
        case 'acknowledged':
          return { kind: 'acknowledged' }
        case 'rejected': {
          const index = draft.photos.findIndex((photo) => photo.id === outcome.photoId)
          return { kind: 'rejected', reason: outcome.reason, photoIndex: index === -1 ? null : index }
        }
        case 'transient':
          if (outcome.retryAfterMs !== null) scheduleRateLimitRetry(outcome.retryAfterMs)
          return durable ? { kind: 'saved-for-later' } : { kind: 'not-saved', photoCount: draft.photos.length }
        case 'busy':
          return durable ? { kind: 'saved-for-later' } : { kind: 'not-saved', photoCount: draft.photos.length }
        case 'not-yours':
          return durable ? { kind: 'saved-for-later' } : { kind: 'not-saved', photoCount: draft.photos.length }
      }
    },
    [],
  )

  const enqueueCheckpoint = useCallback(
    (tripId: string, evidence: CheckpointEvidence, attention: RetainedAttention | null = null) => {
      const entry: CheckpointQueueEntry = {
        kind: 'checkpoint', id: crypto.randomUUID(), tripId, evidence,
        enqueuedAt: new Date().toISOString(),
        ...stampFor(tripId, evidence.custodySequence !== undefined
          ? { actorId: currentActorId(), custodySequence: evidence.custodySequence }
          : undefined),
        ...(attention !== null ? { status: 'needs-attention' as const, attention } : {}),
      }
      const persisted = saveQueue([...loadQueue(), entry])
      publishCounts()
      return persisted
    },
    [],
  )

  const enqueueLocation = useCallback(
    (tripId: string, pings: LocationPingBody[], custody?: CustodyStamp, attention: RetainedAttention | null = null) => {
      const entry: LocationQueueEntry = {
        kind: 'location', id: crypto.randomUUID(), tripId, pings,
        enqueuedAt: new Date().toISOString(),
        ...stampFor(tripId, custody),
        ...(attention !== null ? { status: 'needs-attention' as const, attention } : {}),
      }
      const persisted = saveQueue([...loadQueue(), entry])
      publishCounts()
      return persisted
    },
    [],
  )

  useEffect(() => {
    void flushQueue()

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') void flushQueue()
    }

    window.addEventListener('online', flushQueue)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('online', flushQueue)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return {
    queueLength, attentionCount, retryAttention,
    enqueuePhase, enqueueException, submitExceptionReport, enqueueCheckpoint, enqueueLocation,
    flush: flushQueue,
  }
}
