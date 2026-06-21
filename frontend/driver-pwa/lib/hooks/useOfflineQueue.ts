// frontend/driver-pwa/lib/hooks/useOfflineQueue.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { submitHandshake } from '@/lib/api/handshakes'
import type { HandshakeType } from '@shared/lib/types/handshake'
import type { HandshakeEvidence } from '@/lib/types/evidence-draft'

interface QueueEntry {
  id: string
  tripId: string
  handshakeType: HandshakeType
  evidence: HandshakeEvidence
  enqueuedAt: string
}

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
        await submitHandshake(entry.tripId, entry.handshakeType, entry.evidence)
      } catch {
        failed.push(entry)
      }
    }
    saveQueue(failed)
    setQueueLength(failed.length)
  }, [])

  const enqueue = useCallback(
    (tripId: string, handshakeType: HandshakeType, evidence: HandshakeEvidence) => {
      const entry: QueueEntry = {
        id: crypto.randomUUID(),
        tripId,
        handshakeType,
        evidence,
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

  return { queueLength, enqueue, flush }
}
