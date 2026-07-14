// frontend/driver-pwa/lib/hooks/useOfflineQueue.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
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

export function useOfflineQueue() {
  // Lazy initializer reads the persisted queue length on mount rather than
  // defaulting to 0 and correcting it inside an effect (which would trigger
  // an avoidable cascading re-render — flagged by react-hooks/set-state-in-effect).
  const [queueLength, setQueueLength] = useState(() => loadQueue().length)

  const flush = useCallback(async () => {
    const queue = loadQueue()
    if (queue.length === 0) return
    const failed: QueueEntry[] = []
    for (const entry of queue) {
      try {
        await sendEntry(entry)
      } catch (err) {
        // A terminal 4xx (validation failure, or a 409 meaning this exact submission
        // already succeeded on an earlier attempt) will never succeed on retry — drop it
        // instead of retrying forever. Network errors and 5xx stay queued.
        if (err instanceof ApiError && err.status < 500) {
          console.warn(`useOfflineQueue: dropping terminal failure (${err.status}) for queued entry "${entry.id}"`, err.message)
          continue
        }
        failed.push(entry)
      }
    }
    saveQueue(failed)
    setQueueLength(failed.length)
  }, [])

  const enqueue = useCallback(
    (tripId: string, handshakeType: HandshakeType, evidence: HandshakeEvidence) => {
      const entry: HandshakeQueueEntry = {
        kind: 'handshake', id: crypto.randomUUID(), tripId, handshakeType, evidence,
        enqueuedAt: new Date().toISOString(),
      }
      const q = [...loadQueue(), entry]
      saveQueue(q)
      setQueueLength(q.length)
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
      setQueueLength(q.length)
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
      setQueueLength(q.length)
    },
    [],
  )

  useEffect(() => {
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [flush])

  return { queueLength, enqueue, enqueueException, enqueueCheckpoint, flush }
}
