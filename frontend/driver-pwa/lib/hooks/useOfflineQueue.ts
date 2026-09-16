'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { submitPhase } from '@/lib/api/phases'
import { raiseException, type RaiseExceptionBody } from '@/lib/api/exceptions'
import { uploadArtifact } from '@/lib/api/artifacts'
import { submitCheckpoint, type CheckpointEvidence } from '@/lib/api/checkpoints'
import { recordLocations, type LocationPingBody } from '@/lib/api/locations'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import { ApiError } from '@/lib/api/client'
import type { PhaseType } from '@shared/lib/types/phase'
import type { PhaseEvidence } from '@/lib/types/evidence-draft'

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

// Exceptions queue the already-built request body. One raised WITH a photo (FP-150) also
// carries the image, since its upload hasn't happened yet — see sendException below.
interface ExceptionQueueEntry {
  kind: 'exception'
  id: string
  tripId: string
  body: RaiseExceptionBody
  // Compressed JPEG data URL, not a Blob/File — this queue persists via JSON.stringify
  // into localStorage, and a Blob would serialise to {}.
  photoDataUrl?: string
  // When the photo was taken, not when the report was filed.
  photoCapturedAt?: string
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

type QueueEntry = PhaseQueueEntry | ExceptionQueueEntry | CheckpointQueueEntry | LocationQueueEntry

/** A photo captured for an exception that could not be uploaded before it was queued. */
export interface QueuedExceptionPhoto {
  dataUrl: string
  capturedAt: string
}

/**
 * What made it to disk. `persisted: false` means the report never flushes;
 * `photoPersisted: false` with `persisted: true` means the report saved but its photo
 * was dropped to fit.
 */
export interface EnqueueExceptionResult {
  persisted: boolean
  photoPersisted: boolean
}

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

async function sendEntry(entry: QueueEntry): Promise<void> {
  if (entry.kind === 'phase') {
    // Same key on every attempt — a replay against an already-resolved phase
    // short-circuits server-side to a 200 instead of duplicating evidence.
    await submitPhase(
      entry.tripId, entry.phaseEventId, entry.phaseType, entry.evidence,
      entry.idempotencyKey, entry.position ?? null, entry.driverCapturedAt, entry.acknowledgement ?? null,
    )
  } else if (entry.kind === 'checkpoint') {
    await submitCheckpoint(entry.tripId, entry.evidence)
  } else if (entry.kind === 'location') {
    await recordLocations(entry.tripId, entry.pings)
  } else {
    await sendException(entry)
  }
}

// Written straight to localStorage so a crash between the upload and the exception POST
// resumes from the new state instead of re-uploading the same image on the next flush.
function persistUploadedExceptionArtifact(entryId: string, artifactId: string): void {
  const queue = loadQueue()
  const updated = queue.map((e) =>
    e.kind === 'exception' && e.id === entryId
      ? {
          ...e,
          body: { ...e.body, supporting_artifact_id: artifactId },
          photoDataUrl: undefined,
          photoCapturedAt: undefined,
        }
      : e,
  )
  saveQueue(updated)
}

// Upload-then-raise, mirroring the exception page's online flow.
async function sendException(entry: ExceptionQueueEntry): Promise<void> {
  let body = entry.body

  // Nothing to upload if there's no photo, or the page already got an artifact id
  // (re-uploading would duplicate the evidence).
  if (entry.photoDataUrl && !body.supporting_artifact_id) {
    try {
      const artifact = await uploadArtifact({
        tripId: entry.tripId,
        artifactType: 'photo',
        dataUrl: entry.photoDataUrl,
        capturedAt: entry.photoCapturedAt ?? entry.enqueuedAt,
      })
      body = { ...body, supporting_artifact_id: artifact.id }
      // Persisted now, before the exception POST, so a crash mid-flush can't re-upload.
      persistUploadedExceptionArtifact(entry.id, artifact.id)
    } catch (err) {
      // A terminal 4xx rejects this photo identically on every retry — send the report
      // unillustrated rather than losing it entirely.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        console.warn(
          `useOfflineQueue: queued exception photo rejected (${err.status}) — sending the report without it`,
          err.message,
        )
      } else {
        // Transient: keep the entry intact and let flushQueue retry it.
        throw err
      }
    }
  }

  await raiseException(entry.tripId, body)
}

// This queue is read by more than one mounted hook instance (OfflineBanner + the active
// trip-flow page), each running its own mount-time flush(). The mutex and UI state live
// at module scope so every instance shares one flush-in-flight guard, preventing a
// second flush from re-sending evidence still mid-upload in another instance.
let flushingGlobal = false
const DEFAULT_RATE_LIMIT_RETRY_MS = 60_000
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
  // Terminally-dropped entries (excluding 409s) not yet acknowledged by the driver.
  // Tracked in memory only — no durable localStorage record to recompute from.
  droppedCount: number
}

type StoreListener = () => void

const storeListeners = new Set<StoreListener>()

let storeState: QueueStoreState = { length: loadQueue().length, droppedCount: 0 }

// Frozen so useSyncExternalStore's SSR hydration snapshot stays referentially stable.
const SERVER_STORE_SNAPSHOT: QueueStoreState = { length: 0, droppedCount: 0 }

function publishStoreState(patch: Partial<QueueStoreState>): void {
  storeState = { ...storeState, ...patch }
  storeListeners.forEach((listener) => listener())
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

/**
 * Test-only reset for the module-scope store — `localStorage.clear()` alone can't reset
 * droppedCount, which has no durable backing. Not part of the public hook API.
 */
export function __resetOfflineQueueStoreForTests(): void {
  flushingGlobal = false
  clearRateLimitRetry()
  storeState = { length: loadQueue().length, droppedCount: 0 }
}

async function flushQueue(): Promise<void> {
  if (flushingGlobal) return
  flushingGlobal = true
  try {
    const queue = loadQueue()
    if (queue.length === 0) return

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
    const currentQueue = loadQueue()
    const remaining = currentQueue.filter((entry) => !disposedIds.has(entry.id))
    saveQueue(remaining)
    if (remaining.length === 0) clearRateLimitRetry()
    publishStoreState({
      length: remaining.length,
      droppedCount: storeState.droppedCount + newlyDropped,
    })
  } finally {
    flushingGlobal = false
  }
}

export function useOfflineQueue() {
  const { length: queueLength, droppedCount } = useSyncExternalStore(
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
      const q = [...loadQueue(), entry]
      saveQueue(q)
      publishStoreState({ length: q.length })
    },
    [],
  )

  const enqueueException = useCallback(
    (tripId: string, body: RaiseExceptionBody, photo?: QueuedExceptionPhoto): EnqueueExceptionResult => {
      // Generated once, reused as the wire client_report_id on every resend of this entry.
      const id = crypto.randomUUID()
      const clientReportId = body.client_report_id ?? id
      const base = {
        kind: 'exception' as const, id, tripId,
        body: { ...body, client_report_id: clientReportId },
        enqueuedAt: new Date().toISOString(),
      }
      const entry: ExceptionQueueEntry = photo
        ? { ...base, photoDataUrl: photo.dataUrl, photoCapturedAt: photo.capturedAt }
        : base

      const q = [...loadQueue(), entry]
      if (saveQueue(q)) {
        publishStoreState({ length: q.length })
        return { persisted: true, photoPersisted: photo !== undefined }
      }

      // Write refused — almost always the ~5MB localStorage quota, and the photo is the
      // only part of this entry large enough to be the cause. Retry without it.
      if (photo) {
        const textOnly = [...loadQueue(), base]
        if (saveQueue(textOnly)) {
          publishStoreState({ length: textOnly.length })
          return { persisted: true, photoPersisted: false }
        }
      }

      // Storage unavailable entirely — flushQueue reads from localStorage, so nothing
      // here will ever send; the caller must tell the driver it didn't save.
      return { persisted: false, photoPersisted: false }
    },
    [],
  )

  const enqueueCheckpoint = useCallback(
    (tripId: string, evidence: CheckpointEvidence) => {
      const entry: CheckpointQueueEntry = {
        kind: 'checkpoint', id: crypto.randomUUID(), tripId, evidence,
        enqueuedAt: new Date().toISOString(),
      }
      const q = [...loadQueue(), entry]
      saveQueue(q)
      publishStoreState({ length: q.length })
    },
    [],
  )

  const enqueueLocation = useCallback(
    (tripId: string, pings: LocationPingBody[]) => {
      const entry: LocationQueueEntry = {
        kind: 'location', id: crypto.randomUUID(), tripId, pings,
        enqueuedAt: new Date().toISOString(),
      }
      const q = [...loadQueue(), entry]
      saveQueue(q)
      publishStoreState({ length: q.length })
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
    queueLength, droppedCount, dismissDropped,
    enqueuePhase, enqueueException, enqueueCheckpoint, enqueueLocation, flush,
  }
}
