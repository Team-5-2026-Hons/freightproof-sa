'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { submitPhase } from '@/lib/api/phases'
import { raiseException, type RaiseExceptionBody } from '@/lib/api/exceptions'
import { submitCheckpoint, type CheckpointEvidence } from '@/lib/api/checkpoints'
import { recordLocations, type LocationPingBody } from '@/lib/api/locations'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import { ApiError } from '@/lib/api/client'
import type { PhaseType } from '@shared/lib/types/phase'
import type { PhaseEvidence } from '@/lib/types/evidence-draft'
import {
  ExceptionStoreError,
  getExceptionEnvelope,
  listExceptionEnvelopes,
  removeExceptionEnvelope,
  resetExceptionToPending,
  saveExceptionEnvelope,
  type ExceptionEnvelope,
  type ExceptionPhotoRecord,
  type ExceptionReportBody,
} from '@/lib/offline/exception-store'
import type { ExceptionSendOutcome } from '@/lib/offline/exception-sync'
import {
  DEFAULT_RATE_LIMIT_RETRY_MS, dataUrlToBlob, sendExceptionReport, tryReportLock, waitReportLock,
} from '@/lib/offline/exception-sync'
import { migrateLegacyExceptionEntries, type LegacyExceptionEntry } from '@/lib/offline/legacy-exception-migration'

// Addresses one specific PhaseEvent row via phaseEventId — phaseType alone is ambiguous
// on a cross-dock plan (unloading can occur more than once).
interface PhaseQueueEntry {
  kind: 'phase'
  id: string
  tripId: string
  phaseEventId: string
  phaseType: PhaseType
  evidence: PhaseEvidence
  // Wire idempotency_key — generated once at enqueue (same value as `id`) and never
  // regenerated on retry, so every replay sends the exact key the first attempt sent.
  idempotencyKey: string
  // Captured silently at swipe time and stored with the entry, not re-taken at replay —
  // a late ping would falsely claim the driver was wherever signal returned.
  position: DriverPosition | null
  // Stamped at swipe time and stored with the entry — a replay hours later must report
  // the original instant, not the flush-time clock, or the backend's skew check misfires.
  driverCapturedAt: string
  // Acknowledgement is evidence of the warning the driver saw at the original
  // attempt. It must travel with the queued capture, never be requested on replay.
  acknowledgement: LocationWarningAcknowledgement | null
  enqueuedAt: string
}

// No separate upload-then-complete sequence: submitCheckpoint already does both.
interface CheckpointQueueEntry {
  kind: 'checkpoint'
  id: string
  tripId: string
  evidence: CheckpointEvidence
  enqueuedAt: string
}

// Queued as a batch — several fixes from a dead zone, replayed in one call once signal
// returns. No idempotency key needed: a duplicated ping is just a duplicate trail row.
interface LocationQueueEntry {
  kind: 'location'
  id: string
  tripId: string
  pings: LocationPingBody[]
  enqueuedAt: string
}

// Exceptions no longer queue here: they live in IndexedDB (lib/offline/exception-store.ts)
// because their photos are Blobs. The legacy shape stays in the union only so entries
// written by the previous build are still read, migrated, and — if migration cannot run —
// left untouched rather than dropped.
type QueueEntry = PhaseQueueEntry | LegacyExceptionEntry | CheckpointQueueEntry | LocationQueueEntry

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

const QUEUE_KEY = 'fp_offline_queue'

function loadQueue(): QueueEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(QUEUE_KEY) : null
    return raw ? (JSON.parse(raw) as QueueEntry[]) : []
  } catch {
    // Corrupted or unreadable queue treated as having nothing pending.
    return []
  }
}

// Returns whether the write landed, so callers relying on it (a queued exception) can
// tell "saved for later" from "gone on refresh".
function saveQueue(entries: QueueEntry[]): boolean {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(entries))
    return true
  } catch {
    // Quota exceeded or storage disabled — still updates in memory, won't survive reload.
    console.warn(`useOfflineQueue: failed to persist queue for key "${QUEUE_KEY}"`)
    return false
  }
}

async function sendEntry(entry: Exclude<QueueEntry, LegacyExceptionEntry>): Promise<void> {
  if (entry.kind === 'phase') {
    // Same key on every attempt — a replay against an already-resolved phase
    // short-circuits server-side to a 200 instead of duplicating evidence.
    await submitPhase(
      entry.tripId, entry.phaseEventId, entry.phaseType, entry.evidence,
      entry.idempotencyKey, entry.position ?? null, entry.driverCapturedAt, entry.acknowledgement ?? null,
    )
  } else if (entry.kind === 'checkpoint') {
    await submitCheckpoint(entry.tripId, entry.evidence)
  } else {
    await recordLocations(entry.tripId, entry.pings)
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

function isLegacyException(entry: QueueEntry): entry is LegacyExceptionEntry {
  return entry.kind === 'exception'
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
  // Everything waiting to sync: localStorage entries (including exceptions not yet
  // migrated) plus pending exception reports in IndexedDB.
  length: number
  // Terminally-dropped entries (excluding 409s) not yet acknowledged by the driver.
  // Tracked in memory only — no durable localStorage record to recompute from.
  droppedCount: number
  // Exception reports the server refused. They are kept, never auto-deleted, and are NOT
  // part of `length` because they will not retry by themselves.
  attentionCount: number
}

type StoreListener = () => void

const storeListeners = new Set<StoreListener>()

// IndexedDB is async, so these mirror its contents and are refreshed from it
// (refreshExceptionCounts); everything else in the state is computed synchronously.
let pendingEnvelopeCount = 0
let attentionEnvelopeCount = 0
// Bumped by the test reset so a refresh that started before it cannot write stale counts
// into the next test's state.
let storeEpoch = 0

let storeState: QueueStoreState = { length: loadQueue().length, droppedCount: 0, attentionCount: 0 }

// Frozen so useSyncExternalStore's SSR hydration snapshot stays referentially stable.
const SERVER_STORE_SNAPSHOT: QueueStoreState = { length: 0, droppedCount: 0, attentionCount: 0 }

function publishStoreState(patch: Partial<QueueStoreState>): void {
  storeState = { ...storeState, ...patch }
  storeListeners.forEach((listener) => listener())
}

// Re-derives every count from where it actually lives, so no caller has to remember to
// add the IndexedDB share to a localStorage length.
function publishCounts(patch: Partial<QueueStoreState> = {}): void {
  publishStoreState({
    length: loadQueue().length + pendingEnvelopeCount,
    attentionCount: attentionEnvelopeCount,
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
    attentionEnvelopeCount = envelopes.filter((e) => e.status === 'needs-attention').length
    pendingEnvelopeCount = envelopes.length - attentionEnvelopeCount
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

// Clears the driver-visible "items could not be synced" notice.
function dismissDropped(): void {
  publishStoreState({ droppedCount: 0 })
}

// Counts at module load, so a banner mounted on a fresh launch knows about reports left
// from the last session without waiting for the first flush.
if (typeof window !== 'undefined') void refreshExceptionCounts()

/**
 * Test-only reset for the module-scope store — `localStorage.clear()` alone can't reset
 * droppedCount, which has no durable backing. Not part of the public hook API.
 */
export function __resetOfflineQueueStoreForTests(): void {
  flushingGlobal = false
  clearRateLimitRetry()
  storeEpoch += 1
  pendingEnvelopeCount = 0
  attentionEnvelopeCount = 0
  storeState = { length: loadQueue().length, droppedCount: 0, attentionCount: 0 }
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
  let envelopes: ExceptionEnvelope[]
  try {
    envelopes = await listExceptionEnvelopes()
  } catch (err) {
    if (!(err instanceof ExceptionStoreError) || err.failure !== 'unavailable') {
      console.warn('useOfflineQueue: could not list exception reports', err)
    }
    return
  }
  for (const listed of envelopes) {
    if (listed.status !== 'pending') continue
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
  flushingGlobal = true
  try {
    await migrateLegacyExceptions()
    await flushExceptionEnvelopes()

    const queue = loadQueue()
    // IDs this pass finished with — sent, or dropped as unrecoverable. Anything not in
    // this set (transient failures) stays queued for the next flush.
    const disposedIds = new Set<string>()
    let newlyDropped = 0

    // Trips whose phase queue stalled this pass. The backend enforces ledger ordering
    // (an earlier PENDING phase 409s the next), so a transient failure on one phase
    // entry must block later phase entries for the same trip from sending out of order.
    // The stall is deliberately unbounded: on an evidence platform, stuck-but-intact
    // evidence is safer than evidence sent out of order and silently 409-dropped.
    const stalledTripIds = new Set<string>()

    for (const entry of queue) {
      // A legacy exception that could not be migrated waits for the store; it is never
      // sent from here and never dropped.
      if (isLegacyException(entry)) continue
      if (entry.kind === 'phase' && stalledTripIds.has(entry.tripId)) continue

      try {
        await sendEntry(entry)
        disposedIds.add(entry.id)
      } catch (err) {
        // A terminal 4xx never succeeds on retry — drop it. A 429 is temporary and stays
        // queued until Retry-After elapses. status === 0 (no HTTP response at all) is a
        // transient network failure, not a server rejection, and must stay queued.
        const isRateLimited = err instanceof ApiError && err.status === 429
        if (isRateLimited) {
          scheduleRateLimitRetry(err.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS)
        }
        const isTerminal4xx = (
          err instanceof ApiError
          && err.status >= 400
          && err.status < 500
          && !isRateLimited
        )
        if (isTerminal4xx) {
          disposedIds.add(entry.id)
          // A 409 means an earlier attempt already landed — drop silently. Any other
          // terminal 4xx means evidence is genuinely lost and the driver needs to know.
          if (err.status !== 409) newlyDropped += 1
          console.warn(`useOfflineQueue: dropping terminal failure (${err.status}) for queued entry "${entry.id}"`, err.message)
          continue
        }
        // Transient failure: leave it queued. If this was a phase entry, mark its trip
        // stalled so later entries for the same trip aren't sent out of order this pass.
        if (entry.kind === 'phase') stalledTripIds.add(entry.tripId)
      }
    }

    // Re-read localStorage rather than trusting the pre-flush snapshot: sends above can
    // take up to ~30s, and another mounted instance may have enqueued meanwhile.
    // Filtering the current stored queue preserves those late arrivals.
    if (disposedIds.size > 0) {
      saveQueue(loadQueue().filter((entry) => !disposedIds.has(entry.id)))
    }
    await refreshExceptionCounts()
    publishCounts({ droppedCount: storeState.droppedCount + newlyDropped })
    if (storeState.length === 0) clearRateLimitRetry()
  } finally {
    flushingGlobal = false
  }
}

// The driver's "Try again": every report the server refused goes back to pending and the
// queue flushes. The same clientReportId is kept, so nothing is duplicated server-side.
async function retryAttention(): Promise<void> {
  try {
    const envelopes = await listExceptionEnvelopes()
    for (const envelope of envelopes) {
      if (envelope.status === 'needs-attention') await resetExceptionToPending(envelope.clientReportId)
    }
  } catch (err) {
    console.warn('useOfflineQueue: could not reset reports for retry', err)
  }
  await refreshExceptionCounts()
  await flushQueue()
}

// The driver's explicit "Dismiss" — the only way a refused report is ever deleted.
async function dismissAttention(): Promise<void> {
  try {
    const envelopes = await listExceptionEnvelopes()
    for (const envelope of envelopes) {
      if (envelope.status === 'needs-attention') await removeExceptionEnvelope(envelope.clientReportId)
    }
  } catch (err) {
    console.warn('useOfflineQueue: could not dismiss reports', err)
  }
  await refreshExceptionCounts()
}

export function useOfflineQueue() {
  const { length: queueLength, droppedCount, attentionCount } = useSyncExternalStore(
    subscribeToStore,
    getStoreSnapshot,
    getServerStoreSnapshot,
  )

  const enqueuePhase = useCallback(
    (
      tripId: string, phaseEventId: string, phaseType: PhaseType, evidence: PhaseEvidence,
      position: DriverPosition | null, driverCapturedAt: string,
      acknowledgement: LocationWarningAcknowledgement | null = null,
    ) => {
      // Generated once, reused as both the queue id and the wire idempotency_key, so a
      // resend of this entry is indistinguishable server-side from the original attempt.
      const id = crypto.randomUUID()
      const entry: PhaseQueueEntry = {
        kind: 'phase', id, tripId, phaseEventId, phaseType, evidence, idempotencyKey: id,
        position, driverCapturedAt, acknowledgement: acknowledgement ?? null,
        enqueuedAt: new Date().toISOString(),
      }
      if (saveQueue([...loadQueue(), entry])) {
        publishCounts()
        return
      }

      // Write refused — almost always the ~5MB localStorage quota. A loading's linehaul PDF
      // wraps the same JPEG as the scan, so it roughly doubles the entry; the scan is the
      // evidence, so retry without the PDF image. Any id its early upload produced stays.
      if ('linehaulPdfDataUrl' in evidence && evidence.linehaulPdfDataUrl) {
        saveQueue([...loadQueue(), { ...entry, evidence: { ...evidence, linehaulPdfDataUrl: null } }])
      }
      publishCounts()
    },
    [],
  )

  const enqueueException = useCallback(
    async (tripId: string, body: RaiseExceptionBody, photos: QueuedExceptionPhoto[] = []): Promise<EnqueueExceptionResult> => {
      // Generated once, reused as the wire client_report_id on every resend of this report.
      const clientReportId = body.client_report_id ?? crypto.randomUUID()
      const now = new Date().toISOString()
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
            body: { ...reportBody, client_report_id: clientReportId },
            photos: records,
            status: 'pending',
            attentionReason: null,
            attentionPhotoId: null,
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
      let envelope: ExceptionEnvelope = {
        clientReportId: draft.clientReportId,
        tripId: draft.tripId,
        body: draft.body,
        photos,
        status: 'pending',
        attentionReason: null,
        attentionPhotoId: null,
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
        outcome = await sendExceptionReport(envelope, { durable, lockHeld: true, post, onProgress })
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
      }
    },
    [],
  )

  const enqueueCheckpoint = useCallback(
    (tripId: string, evidence: CheckpointEvidence) => {
      const entry: CheckpointQueueEntry = {
        kind: 'checkpoint', id: crypto.randomUUID(), tripId, evidence,
        enqueuedAt: new Date().toISOString(),
      }
      saveQueue([...loadQueue(), entry])
      publishCounts()
    },
    [],
  )

  const enqueueLocation = useCallback(
    (tripId: string, pings: LocationPingBody[]) => {
      const entry: LocationQueueEntry = {
        kind: 'location', id: crypto.randomUUID(), tripId, pings,
        enqueuedAt: new Date().toISOString(),
      }
      saveQueue([...loadQueue(), entry])
      publishCounts()
    },
    [],
  )

  // Stable module-level function, returned as-is so identity never changes across renders.
  const flush = flushQueue

  useEffect(() => {
    // The 'online' event alone misses entries queued while the browser still believed it
    // was online (backend down). Mount + visibilitychange catch that case too.
    void flush()

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') void flush()
    }

    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [flush])

  return {
    queueLength, droppedCount, dismissDropped, attentionCount, retryAttention, dismissAttention,
    enqueuePhase, enqueueException, submitExceptionReport, enqueueCheckpoint, enqueueLocation, flush,
  }
}
