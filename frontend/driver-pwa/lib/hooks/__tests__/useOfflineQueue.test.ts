// frontend/driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOfflineQueue, __resetOfflineQueueStoreForTests } from '../useOfflineQueue'
import { ApiError } from '@/lib/api/client'
import type { DriverPosition } from '@/lib/types/location'
import type { ActivationEvidence } from '@/lib/types/evidence-draft'
import type { CheckpointEvidence } from '@/lib/api/checkpoints'

// Mock submitPhase/raiseException/submitCheckpoint so tests don't hit the network
vi.mock('@/lib/api/phases', () => ({
  submitPhase: vi.fn().mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' }),
}))
vi.mock('@/lib/api/exceptions', () => ({
  raiseException: vi.fn().mockResolvedValue({ id: 'exc-1' }),
}))
vi.mock('@/lib/api/checkpoints', () => ({
  submitCheckpoint: vi.fn().mockResolvedValue({ id: 'cp-1' }),
}))

// Clear mock call history too — flush() now also runs on every mount, so call counts
// would otherwise accumulate across tests and break the toHaveBeenCalledTimes asserts.
// (clearAllMocks keeps the module-level mockResolvedValue implementations intact.)
// The module-scope store reset must run AFTER localStorage.clear() — it recomputes
// queue length from storage, so the order guarantees each test starts at length 0
// with no leftover droppedCount or stuck flush mutex from a prior test.
beforeEach(() => {
  localStorage.clear()
  __resetOfflineQueueStoreForTests()
  vi.clearAllMocks()
})

const EVIDENCE: ActivationEvidence = {
  capturedAt: '2026-06-12T10:00:00Z',
}

// Queued WITH the entry, not re-taken at replay: the fix must say where the driver was
// when they swiped, not where they were when signal came back.
const POSITION: DriverPosition = { lat: -26.09, lng: 28.13, accuracyM: 8 }

const CHECKPOINT_EVIDENCE: CheckpointEvidence = {
  gpsLat: -29.85, gpsLng: 31.02,
  selfieDataUrl: 'data:img/selfie', cargoPhotoDataUrl: 'data:img/cargo',
  note: '', isDeviation: false, capturedAt: '2026-06-12T10:00:00Z',
}

describe('useOfflineQueue', () => {
  it('starts with empty queue', () => {
    const { result } = renderHook(() => useOfflineQueue())
    expect(result.current.queueLength).toBe(0)
  })

  it('enqueuePhase increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].tripId).toBe('trip-1')
    expect(stored[0].phaseEventId).toBe('phase-event-1')
    expect(stored[0].phaseType).toBe('activation')
  })

  // Task 5.3: the entry's own id (generated once, at enqueue time) IS the idempotency
  // key sent to the server — proving that wiring here, at the point the entry is built.
  it('enqueuePhase stamps the entry id as its own idempotencyKey', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].idempotencyKey).toBe(stored[0].id)
    expect(typeof stored[0].idempotencyKey).toBe('string')
    expect(stored[0].idempotencyKey.length).toBeGreaterThan(0)
  })

  it('flush calls submitPhase for each entry and clears the queue', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
    await act(() => result.current.flush())
    expect(submitPhase).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
  })

  // Task 5.3: the same idempotency_key must reach the server on a retry as on the
  // first attempt — a queued entry is never rebuilt with a fresh key between flushes.
  it('sends the same idempotency_key on a retry as on the first attempt', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(0, 'timed out'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))

    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1) // transient failure — still queued

    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(0) // second attempt succeeds

    expect(submitPhase).toHaveBeenCalledTimes(2)
    const firstKey = vi.mocked(submitPhase).mock.calls[0][4]
    const secondKey = vi.mocked(submitPhase).mock.calls[1][4]
    expect(firstKey).toBe(secondKey)
  })

  // The server dedupes a replay against an already-resolved phase and still returns a
  // plain 200 (`_gate_and_load`'s short-circuit, phase_service.py:108-134) — submitPhase
  // surfaces that as `phaseStatus`, not as a thrown error, so from the queue's point of
  // view this is an ordinary successful send: the entry is dequeued once, cleanly, with
  // no retry loop and no drop-notification — it must not be double-counted as a fresh
  // completion needing special handling.
  it('offline replay of an already-completed phase is a plain, one-time dequeue — not a fresh completion, not a drop', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockResolvedValueOnce({ ok: true, trip: null, phaseStatus: 'completed' })
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))

    await act(() => result.current.flush())

    expect(submitPhase).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
    expect(result.current.droppedCount).toBe(0)

    // A second flush pass with nothing left queued must not re-send anything — proves
    // the completed replay was truly disposed of, not left half-resolved.
    await act(() => result.current.flush())
    expect(submitPhase).toHaveBeenCalledTimes(1)
  })

  it('enqueueException increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' }))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].kind).toBe('exception')
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('flush calls raiseException for a queued exception and clears the queue', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' }))
    await act(() => result.current.flush())
    expect(raiseException).toHaveBeenCalledWith('trip-1', { exception_type: 'panic_button', description: 'x' })
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains a failed entry in the queue and keeps unrelated entries', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  it('flush drops a terminal 4xx failure instead of retrying it forever', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(422, 'invalid evidence'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains an entry on a 5xx ApiError so it can be retried later', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(503, 'service unavailable'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  // Fix 3: checkpoints now enqueue and replay through the same offline-queue contract
  // as phases and exceptions.
  it('enqueueCheckpoint increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].kind).toBe('checkpoint')
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('flush calls submitCheckpoint for a queued checkpoint and clears the queue', async () => {
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    await act(() => result.current.flush())
    expect(submitCheckpoint).toHaveBeenCalledWith('trip-1', CHECKPOINT_EVIDENCE)
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains a queued checkpoint on a 5xx ApiError so it can be retried later', async () => {
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    vi.mocked(submitCheckpoint).mockRejectedValueOnce(new ApiError(503, 'service unavailable'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  // Objective 3: entries queued while the browser still considered itself online (backend
  // down, or a run of 5xxs) never see an 'online' event fire — without an additional
  // trigger they'd sit in localStorage indefinitely.
  describe('flush triggers beyond the "online" event', () => {
    function setVisibility(state: DocumentVisibilityState) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    }

    it('flushes once on mount', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      // Seed a queue entry directly in storage (standing in for "queued on a prior visit")
      // so mount has something to flush.
      localStorage.setItem('fp_offline_queue', JSON.stringify([{
        kind: 'phase', id: 'entry-1', tripId: 'trip-1', phaseEventId: 'phase-event-1',
        phaseType: 'activation', evidence: EVIDENCE, idempotencyKey: 'entry-1',
        enqueuedAt: '2026-06-12T10:00:00Z',
      }]))

      const { result } = renderHook(() => useOfflineQueue())

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.queueLength).toBe(0))
    })

    it('flushes when the document becomes visible again', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      const { result } = renderHook(() => useOfflineQueue())
      // Let the mount-time flush (empty queue, no-op) settle before seeding the queue.
      await act(() => Promise.resolve())

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
      expect(result.current.queueLength).toBe(1)

      setVisibility('visible')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
      })

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.queueLength).toBe(0))
    })

    it('does not flush on a visibilitychange to "hidden"', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
      vi.mocked(submitPhase).mockClear()

      setVisibility('hidden')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
      })

      expect(submitPhase).not.toHaveBeenCalled()
      expect(result.current.queueLength).toBe(1)
    })

    // Regression (Fix 1): ApiError status 0 is the client's code for "no HTTP response
    // received" (request/session timeout) — a transient failure, not a server verdict.
    // The old drop condition (`status < 500`) matched 0 and permanently discarded any
    // entry that timed out during flush, silently losing captured evidence.
    it('flush retains an entry that fails with a status-0 timeout ApiError', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(0, 'Request timed out after 12000ms'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
      await act(() => result.current.flush())

      expect(result.current.queueLength).toBe(1)
      const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ tripId: string }>
      expect(stored).toHaveLength(1)
      expect(stored[0].tripId).toBe('trip-1')
    })

    // Regression (Fix 2): flush used to snapshot the queue up front and then
    // saveQueue(failed) unconditionally at the end — wholesale overwriting anything
    // enqueued while a slow send (photo uploads run up to ~30s) was in flight, which
    // silently erased that evidence. The fix removes only the entries the flush
    // actually disposed of from the *current* stored queue.
    it('flush preserves an entry enqueued while a send was in flight', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      const { raiseException } = await import('@/lib/api/exceptions')
      let resolveSubmit!: () => void
      vi.mocked(submitPhase).mockImplementationOnce(
        () => new Promise((resolve) => { resolveSubmit = () => resolve({ ok: true, trip: null, phaseStatus: 'completed' }) }),
      )

      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))

      // Start a flush that hangs on the phase send, then enqueue a second entry
      // mid-flight — exactly what happens when a driver logs an exception while a
      // queued photo upload is replaying in the background.
      const flushPromise = result.current.flush()
      act(() => result.current.enqueueException('trip-2', { exception_type: 'panic_button', description: 'x' }))

      await act(async () => {
        resolveSubmit()
        await flushPromise
      })

      // The phase entry flushed away; the mid-flush exception must survive in
      // storage rather than being erased by the flush's final write.
      expect(result.current.queueLength).toBe(1)
      const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ kind: string; tripId: string }>
      expect(stored).toHaveLength(1)
      expect(stored[0].kind).toBe('exception')
      expect(stored[0].tripId).toBe('trip-2')
      // The hung send resolved successfully — it must not have been re-sent, and the
      // mid-flush exception must not have been sent by THIS flush (its snapshot
      // predates the enqueue).
      expect(submitPhase).toHaveBeenCalledTimes(1)
      expect(raiseException).not.toHaveBeenCalled()
    })

    it('guards against overlapping flush runs — a second concurrent call is a no-op while one is in flight', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      let resolveSubmit!: () => void
      vi.mocked(submitPhase).mockImplementationOnce(
        () => new Promise((resolve) => { resolveSubmit = () => resolve({ ok: true, trip: null, phaseStatus: 'completed' }) }),
      )

      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))

      // Kick off a flush that will hang on the in-flight submitPhase call, then fire a
      // second flush before the first resolves — the guard should make the second call a
      // pure no-op rather than re-sending the same entry concurrently.
      let firstFlushDone = false
      const firstFlush = result.current.flush().then(() => { firstFlushDone = true })
      await act(() => result.current.flush())

      expect(firstFlushDone).toBe(false)
      expect(submitPhase).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveSubmit()
        await firstFlush
      })

      expect(result.current.queueLength).toBe(0)
    })
  })

  // The flush mutex moved from a per-instance useRef to module scope because two hook
  // instances are now mounted at once (OfflineBanner in AppShell + the open trip-flow
  // page). A per-instance ref could not stop instance B from starting a second flush
  // pass while instance A still had a 30s photo upload in flight — re-sending, i.e.
  // double-submitting, the same evidence.
  describe('cross-instance coordination', () => {
    it('a second hook instance cannot start a flush while another instance is mid-flush', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      let resolveSubmit!: () => void
      vi.mocked(submitPhase).mockImplementationOnce(
        () => new Promise((resolve) => { resolveSubmit = () => resolve({ ok: true, trip: null, phaseStatus: 'completed' }) }),
      )

      // Two concurrently-mounted instances — banner + page, exactly the production shape.
      const first = renderHook(() => useOfflineQueue())
      const second = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => first.result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))

      // Instance A's flush hangs on the in-flight send; instance B's flush must be a
      // pure no-op against the shared module-scope mutex, not a concurrent re-send.
      let firstFlushDone = false
      const firstFlush = first.result.current.flush().then(() => { firstFlushDone = true })
      await act(() => second.result.current.flush())

      expect(firstFlushDone).toBe(false)
      expect(submitPhase).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveSubmit()
        await firstFlush
      })

      // Both instances read the same shared store — no per-instance drift.
      expect(first.result.current.queueLength).toBe(0)
      expect(second.result.current.queueLength).toBe(0)
    })

    it('queueLength updates from one instance are visible to the other', async () => {
      const first = renderHook(() => useOfflineQueue())
      const second = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => first.result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))

      expect(second.result.current.queueLength).toBe(1)
    })
  })

  // Fix 3b: terminal drops used to be console.warn-only — invisible to the driver even
  // though their captured evidence was permanently discarded.
  describe('drop notifications', () => {
    it('a non-409 terminal drop increments droppedCount, and dismissDropped clears it', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(422, 'invalid evidence'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
      await act(() => result.current.flush())

      expect(result.current.queueLength).toBe(0)
      expect(result.current.droppedCount).toBe(1)

      act(() => result.current.dismissDropped())

      expect(result.current.droppedCount).toBe(0)
    })

    it('a 409 drop stays silent — the earlier attempt already succeeded server-side', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(409, 'already submitted'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION))
      await act(() => result.current.flush())

      // Dropped from the queue (correct — the evidence landed on a prior attempt),
      // but with no driver-facing notification.
      expect(result.current.queueLength).toBe(0)
      expect(result.current.droppedCount).toBe(0)
    })
  })

  // Fix 4: the backend now enforces strict ledger ordering — submitting a phase while
  // the phase ahead of it in the same trip's plan is still PENDING returns 409. The
  // catch above drops 409s on the premise that they mean "an earlier attempt already
  // landed" — a premise that stops holding the moment the queue itself still holds an
  // earlier, unsent entry for that trip. Sending out of order in that case would 409 the
  // later entry and have it wrongly dropped as "already landed", silently losing evidence
  // (e.g. an unloading seal photo) that never actually reached the server.
  describe('per-trip phase ordering guard', () => {
    it('does not send a later phase entry for a trip whose earlier phase entry just failed transiently', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(500, 'server error'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => {
        result.current.enqueuePhase('trip-1', 'phase-event-in-transit', 'in_transit', EVIDENCE, POSITION)
        result.current.enqueuePhase('trip-1', 'phase-event-unloading', 'unloading', EVIDENCE, POSITION)
      })

      await act(() => result.current.flush())

      // in_transit failed transiently (still queued) — unloading must be skipped this
      // pass rather than sent and 409-dropped as a false "already landed".
      expect(submitPhase).toHaveBeenCalledTimes(1)
      expect(result.current.queueLength).toBe(2)
      const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ phaseType: string }>
      expect(stored).toHaveLength(2)
      expect(stored.map((entry) => entry.phaseType)).toEqual(['in_transit', 'unloading'])
    })

    it('still flushes a different trip after one trip stalls', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(500, 'server error'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => {
        result.current.enqueuePhase('trip-1', 'phase-event-in-transit', 'in_transit', EVIDENCE, POSITION)
        result.current.enqueuePhase('trip-2', 'phase-event-unloading', 'unloading', EVIDENCE, POSITION)
      })

      await act(() => result.current.flush())

      // The guard is scoped per trip — trip-2's entry has no stalled predecessor of its
      // own, so it must still be attempted and dequeued even while trip-1 is stuck.
      expect(submitPhase).toHaveBeenCalledTimes(2)
      const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ tripId: string }>
      expect(stored).toHaveLength(1)
      expect(stored[0].tripId).toBe('trip-1')
    })

    it('still flushes an exception entry for the same trip after its phase entry stalls', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      const { raiseException } = await import('@/lib/api/exceptions')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(500, 'server error'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => {
        result.current.enqueuePhase('trip-1', 'phase-event-in-transit', 'in_transit', EVIDENCE, POSITION)
        result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' })
      })

      await act(() => result.current.flush())

      // Exceptions (and checkpoints, locations) carry no ledger-ordering constraint —
      // only phase entries are gated by this guard.
      expect(raiseException).toHaveBeenCalledTimes(1)
      const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ kind: string }>
      expect(stored).toHaveLength(1)
      expect(stored[0].kind).toBe('phase')
    })
  })
})
