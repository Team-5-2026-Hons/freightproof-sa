// frontend/driver-pwa/lib/hooks/useOfflineQueue.ts
'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { submitHandshake } from '@/lib/api/handshakes'
import { raiseException, type RaiseExceptionBody } from '@/lib/api/exceptions'
import { submitCheckpoint, type CheckpointEvidence } from '@/lib/api/checkpoints'
import { ApiError } from '@/lib/api/client'
import type { HandshakeType } from '@shared/lib/types/handshake'
import type { HandshakeEvidence } from '@/lib/types/evidence-draft'

interface HandshakeQueueEntry {
  kind: 'handshake'
  id: string
  tripId: string
  handshakeType: HandshakeType
  evidence: HandshakeEvidence
  enqueuedAt: string
}

// Exceptions (and panic, which is just exception_type: 'panic_button') have no
// artifact upload step today, so queuing the already-built request body is enough —
// unlike handshakes, there's no separate "upload then complete" sequence to redo.
interface ExceptionQueueEntry {
  kind: 'exception'
  id: string
  tripId: string
  body: RaiseExceptionBody
  enqueuedAt: string
}

// Checkpoints (like exceptions) have no separate "upload then complete" sequence of
// their own to redo — submitCheckpoint already does the artifact upload + API call as
// one unit, so queuing the raw captured evidence is enough for a full replay.
interface CheckpointQueueEntry {
  kind: 'checkpoint'
  id: string
  tripId: string
  evidence: CheckpointEvidence
  enqueuedAt: string
}

type QueueEntry = HandshakeQueueEntry | ExceptionQueueEntry | CheckpointQueueEntry

const QUEUE_KEY = 'fp_offline_queue'

function loadQueue(): QueueEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(QUEUE_KEY) : null
    return raw ? (JSON.parse(raw) as QueueEntry[]) : []
  } catch {
    // Read-path fallback to empty queue is acceptable — worst case, a corrupted
    // or unreadable queue is treated as having nothing pending.
    return []
  }
}

function saveQueue(entries: QueueEntry[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(entries))
  } catch {
    // Quota exceeded, private browsing, or storage disabled — queue still
    // updates in memory, but won't survive a refresh. Surface this since the
    // hook's entire purpose is persisting unsent handshakes across reloads.
    console.warn(`useOfflineQueue: failed to persist queue for key "${QUEUE_KEY}"`)
  }
}

async function sendEntry(entry: QueueEntry): Promise<void> {
  if (entry.kind === 'handshake') {
    await submitHandshake(entry.tripId, entry.handshakeType, entry.evidence)
  } else if (entry.kind === 'checkpoint') {
    await submitCheckpoint(entry.tripId, entry.evidence)
  } else {
    await raiseException(entry.tripId, entry.body)
  }
}

// ─── Module-scope flush coordination ───────────────────────────────────────────
// This queue is consumed by more than one concurrently-mounted hook instance:
// AppShell mounts OfflineBanner once per screen, and the trip-flow page showing on
// top of it (handshake step, checkpoint, exception, panic) mounts its own instance
// to get enqueue/enqueueException/enqueueCheckpoint. Each instance also runs a
// mount-time flush(). A useRef mutex is per-*instance*, so it could only stop a
// single component from double-flushing itself — it could NOT stop the banner's
// instance from starting a second flush pass while the page's instance still has a
// 30s photo upload in flight, which would re-send (double-submit) the same
// evidence. Moving the mutex — and the state that drives the UI — to module scope
// gives every hook instance in the tab one shared flush-in-flight guard and one
// shared source of truth for queue length / drop notifications.
let flushingGlobal = false

interface QueueStoreState {
  length: number
  // Count of terminally-dropped entries (excluding 409s — see flushQueue) that the
  // driver has not yet acknowledged. Reset to 0 via dismissDropped(). Not derived
  // from localStorage: unlike queue length, "was anything ever dropped" has no
  // durable record to recompute from, so it's tracked purely in memory for the
  // current tab session.
  droppedCount: number
}

type StoreListener = () => void

const storeListeners = new Set<StoreListener>()

let storeState: QueueStoreState = { length: loadQueue().length, droppedCount: 0 }

// A frozen constant (not recomputed) so useSyncExternalStore's SSR hydration pass
// gets a referentially stable snapshot — mirrors the same trick OfflineBanner
// already uses for navigator.onLine (`() => true` as the server snapshot).
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

// Clears the driver-visible "items could not be synced" notice. Exported as a
// stable module-level function (not a per-instance useCallback) since it has no
// component state to close over.
function dismissDropped(): void {
  publishStoreState({ droppedCount: 0 })
}

/**
 * Test-only reset hook for the module-scope store. Because queue length and drop
 * counts now live at module scope instead of a per-instance useState (required so
 * every hook instance shares one flush mutex and one consistent UI state — see the
 * comment above), Vitest's usual `localStorage.clear()` between tests is no longer
 * sufficient to isolate them: droppedCount in particular has no localStorage-backed
 * source of truth to resync from. Not part of the public hook API — only imported
 * by useOfflineQueue.test.ts.
 */
export function __resetOfflineQueueStoreForTests(): void {
  flushingGlobal = false
  storeState = { length: loadQueue().length, droppedCount: 0 }
}

async function flushQueue(): Promise<void> {
  if (flushingGlobal) return
  flushingGlobal = true
  try {
    const queue = loadQueue()
    if (queue.length === 0) return

    // IDs this pass has definitively finished with — sent successfully, or dropped
    // as an unrecoverable terminal failure. Anything NOT in this set (transient
    // failures) is left untouched and simply stays queued for the next flush.
    const disposedIds = new Set<string>()
    let newlyDropped = 0

    for (const entry of queue) {
      try {
        await sendEntry(entry)
        disposedIds.add(entry.id)
      } catch (err) {
        // A real 4xx HTTP response (validation failure, or a 409 meaning this exact
        // submission already succeeded on an earlier attempt) will never succeed on
        // retry — drop it instead of retrying forever. status === 0 is the client's
        // code for "no HTTP response at all" (request/session timeout, offline mid-
        // flush) — that's a transient failure indistinguishable from a network drop,
        // NOT a definitive server rejection, so it must stay queued. Excluding it
        // from this range (rather than the old `status < 500`, which also matched 0)
        // is the fix: the old condition silently discarded any entry that timed out
        // during flush, contradicting the "network errors and 5xx stay queued" intent.
        const isTerminal4xx = err instanceof ApiError && err.status >= 400 && err.status < 500
        if (isTerminal4xx) {
          disposedIds.add(entry.id)
          // A 409 means an earlier attempt already succeeded server-side — the drop
          // is correct and staying silent about it is fine, the evidence did land.
          // Any other terminal 4xx (422 validation, 404, etc.) means evidence is
          // genuinely lost — the driver needs to know so they can re-capture it or
          // flag it to dispatch rather than assume the record made it through.
          if (err.status !== 409) newlyDropped += 1
          console.warn(`useOfflineQueue: dropping terminal failure (${err.status}) for queued entry "${entry.id}"`, err.message)
          continue
        }
        // Transient failure (network error, 5xx, or a status-0 timeout): leave it
        // out of disposedIds so the filter below keeps it queued.
      }
    }

    // Re-read localStorage now rather than trusting the `queue` snapshot taken at
    // the top of this function. Sends above can take up to ~30s each (photo
    // uploads); any enqueue()/enqueueException()/enqueueCheckpoint() call that ran
    // on another mounted instance while this flush was in flight has already
    // appended to localStorage. Filtering the *current* stored queue down to "not
    // disposed of" preserves those late arrivals — entries that failed transiently
    // keep their place automatically, since they were never added to disposedIds.
    // The old `saveQueue(failed)` overwrote storage wholesale with a stale pre-flush
    // view and silently erased anything enqueued mid-flush.
    const currentQueue = loadQueue()
    const remaining = currentQueue.filter((entry) => !disposedIds.has(entry.id))
    saveQueue(remaining)
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

  const enqueue = useCallback(
    (tripId: string, handshakeType: HandshakeType, evidence: HandshakeEvidence) => {
      const entry: HandshakeQueueEntry = {
        kind: 'handshake', id: crypto.randomUUID(), tripId, handshakeType, evidence,
        enqueuedAt: new Date().toISOString(),
      }
      const q = [...loadQueue(), entry]
      saveQueue(q)
      publishStoreState({ length: q.length })
    },
    [],
  )

  const enqueueException = useCallback(
    (tripId: string, body: RaiseExceptionBody) => {
      const entry: ExceptionQueueEntry = {
        kind: 'exception', id: crypto.randomUUID(), tripId, body,
        enqueuedAt: new Date().toISOString(),
      }
      const q = [...loadQueue(), entry]
      saveQueue(q)
      publishStoreState({ length: q.length })
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

  // flushQueue is a stable module-level function (shared by every instance, not
  // recreated per mount) — returned as-is so identity never changes across renders.
  const flush = flushQueue

  useEffect(() => {
    // The 'online' event alone misses entries queued while the browser still believed
    // it was online (backend down, or a run of 5xxs) — those never see an 'online'
    // event fire and would otherwise sit in localStorage indefinitely. A mount-time
    // attempt and a flush on returning to the tab (visibilitychange → 'visible') catch
    // that case.
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

  return { queueLength, droppedCount, dismissDropped, enqueue, enqueueException, enqueueCheckpoint, flush }
}
