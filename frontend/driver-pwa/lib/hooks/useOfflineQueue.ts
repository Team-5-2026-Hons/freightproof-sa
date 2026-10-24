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
  /** One per report draft; reused by every submit press so the server can dedupe. */
  clientReportId: string
  body: ExceptionReportBody
  photos: Array<{ id: string; dataUrl: string; capturedAt: string }>
}

export type ExceptionSubmitOutcome =
  | { kind: 'acknowledged' }
  | { kind: 'saved-for-later' }
  | { kind: 'not-saved'; photoCount: number }
  | { kind: 'rejected'; reason: string; photoIndex: number | null }

// May this queued capture be sent by whoever is signed in now? Only its own capturer,
// and only while it is still pending. An entry with no recorded capturer is never sendable:
// replaying A's evidence with B's token would file it as B's.
function isSendableNow(entry: SendableQueueEntry, actorId: string | null): boolean {
  return entryStatus(entry) === 'pending' && entry.actorId != null && entry.actorId === actorId
}

async function sendEntry(entry: SendableQueueEntry): Promise<void> {
  // The custody period stored at capture, never the one current at flush time.
  const custodySequence = entry.custodySequence ?? null
  if (entry.kind === 'phase') {
    // Same key on every attempt — a replay against an already-resolved phase
    // short-circuits server-side to a 200 instead of duplicating evidence.
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

// The request body for a report whose photos are all uploaded. The first id is also sent
// in the legacy field so an older backend still receives the lead photo.
function reportRequestBody(envelope: ExceptionEnvelope, artifactIds: string[]): RaiseExceptionBody {
  return {
    ...envelope.body,
    ...(artifactIds.length > 0
      ? { supporting_artifact_ids: artifactIds, supporting_artifact_id: artifactIds[0] }
      : {}),
  }
}

// This queue is read by more than one mounted hook instance (OfflineBanner + the active
// trip-flow page), each running its own mount-time flush(). The mutex and UI state live
// at module scope so every instance shares one flush-in-flight guard, preventing a
// second flush from re-sending evidence still mid-upload in another instance.
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
  // Everything this driver has waiting to sync: their pending localStorage entries
  // (including exceptions not yet migrated) plus their pending exception reports.
  length: number
  // Captures waiting on the driver: refused by the server (kept, never auto-deleted) or
  // quarantined because nobody recorded who captured them. NOT part of `length` because
  // they will not retry by themselves. Reviewed on the retained-evidence screen.
  attentionCount: number
  // Captures that belong to another driver account that used this phone. Counted
  // so the driver knows they exist, never listed in detail and never sent with this login.
  heldForOtherAccounts: number
}

type StoreListener = () => void

const storeListeners = new Set<StoreListener>()

// IndexedDB is async, so these mirror its contents and are refreshed from it
// (refreshExceptionCounts); everything else in the state is computed synchronously.
let pendingEnvelopeCount = 0
let attentionEnvelopeCount = 0
let otherAccountEnvelopeCount = 0
// Bumped by the test reset so a refresh that started before it cannot write stale counts
// into the next test's state.
let storeEpoch = 0

interface LocalQueueCounts {
  pending: number
  attention: number
  otherAccounts: number
}

// Splits the localStorage queue by who may act on each entry. Legacy exception entries are
// counted as pending exactly as before: their own migration decides what they become.
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

// Frozen so useSyncExternalStore's SSR hydration snapshot stays referentially stable.
const SERVER_STORE_SNAPSHOT: QueueStoreState = EMPTY_STORE_STATE

function publishStoreState(patch: Partial<QueueStoreState>): void {
  storeState = { ...storeState, ...patch }
  storeListeners.forEach((listener) => listener())
}

// Re-derives every count from where it actually lives, so no caller has to remember to
// add the IndexedDB share to a localStorage length.
function publishCounts(patch: Partial<QueueStoreState> = {}): void {
  const local = localQueueCounts()
  publishStoreState({
    length: local.pending + pendingEnvelopeCount,
    attentionCount: local.attention + attentionEnvelopeCount,
    heldForOtherAccounts: local.otherAccounts + otherAccountEnvelopeCount,
    ...patch,
  })
}

// Reads the envelope counts back from IndexedDB. An unavailable store is a known state
// (legacy entries then stay in localStorage and still count), so it is not logged.
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

// Migrates and counts at module load, so a banner mounted on a fresh launch knows about
// reports left from the last session without waiting for the first flush.
if (typeof window !== 'undefined') {
  migrateQueueForCustody()
  void refreshExceptionCounts()
  // A different (or newly known) signed-in driver changes which captures may send and how
  // they are counted, so flush and recount the moment it changes.
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

// Every stored capture must say who took it. Version-1 queue entries and envelopes
// that do not are quarantined — kept with their bytes, never sent, never reassigned. Both
// steps are idempotent, so this runs before every flush at almost no cost.
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

// Moves exception reports queued by the previous build out of localStorage. Anything that
// cannot be moved (store unavailable or full) is left exactly where it was.
async function migrateLegacyExceptions(): Promise<void> {
  const { failed } = await migrateLegacyExceptionEntries({
    readLegacy: () => loadQueue().filter(isLegacyException),
    dropLegacy: (ids) => {
      const dropped = new Set(ids)
      // Re-read at drop time: another entry may have been enqueued since the read.
      return saveQueue(loadQueue().filter((entry) => !dropped.has(entry.id)))
    },
  })
  if (failed > 0) console.warn(`useOfflineQueue: ${failed} legacy exception report(s) left in localStorage`)
}

// Sends each pending report independently: one that fails — transiently or terminally —
// never holds up the ones behind it.
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
    // Only the capturing account sends its own reports (see isSendableNow).
    if (listed.actorId == null || listed.actorId !== actorId) continue
    // Lock FIRST, then re-read: the list is a snapshot that can be a long upload old, and a
    // page submit may be saving a newer draft of this report. Under the lock what we read is
    // what we send and, on acknowledgement, what we delete.
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
    // IDs this pass finished with: sent, or proven already recorded. Nothing else is ever
    // removed — a refusal is retained (below), a transient failure stays queued.
    const disposedIds = new Set<string>()
    // Entries the server refused this pass, with why. Kept in place, marked for review.
    const retained = new Map<string, RetainedAttention>()

    // Trips whose phase queue stalled this pass. The backend enforces ledger ordering
    // (an earlier PENDING phase 409s the next), so a failure on one phase entry must block
    // later phase entries for the same trip from sending out of order. The stall is
    // deliberately unbounded: on an evidence platform, stuck-but-intact evidence is safer
    // than evidence sent out of order.
    const stalledTripIds = new Set<string>()

    for (const entry of queue) {
      if (!isActorLeaseCurrent(lease)) break
      // A legacy exception that could not be migrated waits for the store; it is never
      // sent from here and never dropped. Unreadable and quarantined entries never send.
      if (!isSendableEntry(entry) || !isSendableNow(entry, actorId)) continue
      if (entry.kind === 'phase' && stalledTripIds.has(entry.tripId)) continue

      try {
        await sendEntry(entry)
        disposedIds.add(entry.id)
      } catch (err) {
        const failure = classifyLiveWriteFailure(err)
        if (failure.kind === 'duplicate') {
          // EVIDENCE_ALREADY_RECORDED for THIS entry's own key: the server holds it, so this
          // one entry — and only it — is cleared.
          disposedIds.add(entry.id)
          continue
        }
        if (failure.kind === 'retain') {
          // Every other refusal, 409 included, is kept with its reason. A 409 is not read as
          // "an earlier attempt landed": it can mean the trip was handed over, and dropping it
          // would delete the driver's evidence.
          retained.set(entry.id, failure.attention)
          console.warn(`useOfflineQueue: retained refused entry "${entry.id}" (${failure.attention.status} ${failure.attention.code ?? 'uncoded'})`)
        } else if (failure.retryAfterMs !== null) {
          scheduleRateLimitRetry(failure.retryAfterMs)
        }
        // An overridden phase is resolved as far as the server's ordering is concerned, so
        // the entries behind it are not out of order and must keep draining in this pass.
        // Every other failure still stalls the trip.
        const overriddenByDispatch = failure.kind === 'retain' && isPhaseOverridden(failure.attention)
        if (entry.kind === 'phase' && !overriddenByDispatch) stalledTripIds.add(entry.tripId)
      }
    }

    // Re-read localStorage rather than trusting the pre-flush snapshot: sends above can
    // take up to ~30s, and another mounted instance may have enqueued meanwhile.
    // Changing the current stored queue preserves those late arrivals.
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

// The driver's "Try again": every capture of theirs the server refused goes back to pending
// and the queue flushes. The same keys are kept, so nothing is duplicated server-side.
// Custody conflicts are NOT retried live — the trip has moved on from this capture's period,
// so a live resend can only be refused again; those go through late evidence instead. Nor is a
// capture for an overridden phase: the row stays overridden, so a resend is refused every time.
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

// The capture-time stamp for a queued item. A caller that already took one at the
// driver's action passes it; otherwise it is taken now, at enqueue.
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
      // Set when the server already refused this capture on a custody conflict, so it
      // is stored for review rather than queued to send.
      attention: RetainedAttention | null = null,
      originalIdempotencyKey?: string,
    ): boolean => {
      // Queue identity is local. An interrupted online attempt must keep its original
      // wire key so the server can prove the same actor's completion after a handover.
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

      // Write refused — almost always the ~5MB localStorage quota. A loading's linehaul PDF
      // wraps the same JPEG as the scan, so it roughly doubles the entry; the scan is the
      // evidence, so retry without the PDF image. Any id its early upload produced stays.
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
      // Generated once, reused as the wire client_report_id on every resend of this report.
      const clientReportId = body.client_report_id ?? crypto.randomUUID()
      const now = new Date().toISOString()
      const stamp = captureCustody(tripId)
      // Photo ids live on the photo records, never in the body: the sender fills them in
      // as each upload lands.
      const {
        supporting_artifact_id: knownArtifactId,
        supporting_artifact_ids: ignoredArtifactIds,
        ...reportBody
      } = body
      void ignoredArtifactIds // photo ids are rebuilt from the photo records
      try {
        const records: ExceptionPhotoRecord[] = photos.map((photo) => ({
          id: crypto.randomUUID(),
          blob: dataUrlToBlob(photo.dataUrl),
          capturedAt: photo.capturedAt,
          uploadedArtifactId: null,
        }))
        // A caller that already uploaded its one photo must not have it uploaded again.
        if (records.length === 0 && knownArtifactId) {
          records.push({ id: crypto.randomUUID(), blob: null, capturedAt: now, uploadedArtifactId: knownArtifactId })
        }
        // Same lock as a send: a re-enqueue of a known report id must not land mid-send.
        const release = await waitReportLock(clientReportId)
        try {
          await saveExceptionEnvelope({
            clientReportId,
            tripId,
            body: {
              ...reportBody,
              client_report_id: clientReportId,
              // The caller's own capture-time stamp wins; otherwise it is taken now.
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
        // Nothing was stored, so nothing will ever flush: the caller must tell the driver.
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
            // Ids come from the draft so a re-submit maps onto the same records.
            id: photo.id,
            blob: dataUrlToBlob(photo.dataUrl),
            capturedAt: photo.capturedAt,
            uploadedArtifactId: null,
          })
        } catch (err) {
          // A photo that cannot be decoded can never upload: say which one, don't throw.
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

      // Save and send under the report's lock. A background flush may be mid-send of an
      // earlier draft of this same report: saving over it unlocked would let that send's
      // acknowledgement delete THIS draft (and its newer photos). Waiting keeps save,
      // send and delete strictly one revision at a time.
      const release = await waitReportLock(draft.clientReportId)
      let durable = true
      let outcome: ExceptionSendOutcome
      try {
        // Store first so a dead battery or signal loss mid-upload costs nothing. If the
        // store refuses, still try to send — the driver is online right now — but progress
        // is then memory-only and the caller is told honestly if it could not be kept.
        try {
          await saveExceptionEnvelope(envelope)
          // Send the STORED copy: the save merged in artifact ids recorded by an earlier
          // attempt, and sending our fresh draft would upload those photos a second time.
          envelope = (await getExceptionEnvelope(draft.clientReportId)) ?? envelope
        } catch (err) {
          durable = false
          console.warn('useOfflineQueue: exception report could not be stored; sending without a saved copy', err)
        }
        // Saving may wait behind an earlier send and IndexedDB. Do not reacquire a
        // returned A account as though this interrupted submission were a new action.
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
          // Unreachable for a fresh draft (it was stamped with the signed-in actor above);
          // reported as saved because the stored copy is kept for its own account.
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
        // The evidence's own stamp (taken when the driver tapped) wins over enqueue time.
        ...stampFor(tripId, evidence.custodySequence !== undefined
          ? { actorId: currentActorId(), custodySequence: evidence.custodySequence }
          : undefined),
        ...(attention !== null ? { status: 'needs-attention' as const, attention } : {}),
      }
      // Whether the write landed: a full or disabled store drops the entry, and the caller must
      // not tell the driver the checkpoint is "stored on this device" when it is not.
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
    // The 'online' event alone misses entries queued while the browser still believed it
    // was online (backend down). Mount + visibilitychange catch that case too.
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
    // A module-level function, so its identity never changes across renders.
    flush: flushQueue,
  }
}
