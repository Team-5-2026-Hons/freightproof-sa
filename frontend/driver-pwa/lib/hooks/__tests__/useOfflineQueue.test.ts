// frontend/driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOfflineQueue, __resetOfflineQueueStoreForTests } from '../useOfflineQueue'
import { ApiError } from '@/lib/api/client'
import type { H1Evidence } from '@/lib/types/evidence-draft'
import type { CheckpointEvidence } from '@/lib/api/checkpoints'

// Mock submitHandshake/raiseException/submitCheckpoint so tests don't hit the network
vi.mock('@/lib/api/handshakes', () => ({
  submitHandshake: vi.fn().mockResolvedValue({ ok: true, eventHash: 'abc', trip: null }),
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

// gateAddress added to H1Evidence (Task 3) — included here as null since this
// fixture predates that field, same fix applied to useHandshakeDraft.test.ts.
const EVIDENCE: H1Evidence = {
  gpsLat: -26.09, gpsLng: 28.13, gateAddress: null, capturedAt: '2026-06-12T10:00:00Z',
}

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

  it('enqueue increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('flush calls submitHandshake for each entry and clears the queue', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(submitHandshake).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
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
    const { submitHandshake } = await import('@/lib/api/handshakes')
    vi.mocked(submitHandshake).mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  it('flush drops a terminal 4xx failure instead of retrying it forever', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    vi.mocked(submitHandshake).mockRejectedValueOnce(new ApiError(422, 'invalid evidence'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains an entry on a 5xx ApiError so it can be retried later', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    vi.mocked(submitHandshake).mockRejectedValueOnce(new ApiError(503, 'service unavailable'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  // Fix 3: checkpoints now enqueue and replay through the same offline-queue contract
  // as handshakes and exceptions.
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
      const { submitHandshake } = await import('@/lib/api/handshakes')
      // Seed a queue entry directly in storage (standing in for "queued on a prior visit")
      // so mount has something to flush.
      localStorage.setItem('fp_offline_queue', JSON.stringify([{
        kind: 'handshake', id: 'entry-1', tripId: 'trip-1', handshakeType: 'origin_gate_in',
        evidence: EVIDENCE, enqueuedAt: '2026-06-12T10:00:00Z',
      }]))

      const { result } = renderHook(() => useOfflineQueue())

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.queueLength).toBe(0))
    })

    it('flushes when the document becomes visible again', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      const { result } = renderHook(() => useOfflineQueue())
      // Let the mount-time flush (empty queue, no-op) settle before seeding the queue.
      await act(() => Promise.resolve())

      act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
      expect(result.current.queueLength).toBe(1)

      setVisibility('visible')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
      })

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.queueLength).toBe(0))
    })

    it('does not flush on a visibilitychange to "hidden"', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
      vi.mocked(submitHandshake).mockClear()

      setVisibility('hidden')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
      })

      expect(submitHandshake).not.toHaveBeenCalled()
      expect(result.current.queueLength).toBe(1)
    })

    // Regression (Fix 1): ApiError status 0 is the client's code for "no HTTP response
    // received" (request/session timeout) — a transient failure, not a server verdict.
    // The old drop condition (`status < 500`) matched 0 and permanently discarded any
    // entry that timed out during flush, silently losing captured evidence.
    it('flush retains an entry that fails with a status-0 timeout ApiError', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      vi.mocked(submitHandshake).mockRejectedValueOnce(new ApiError(0, 'Request timed out after 12000ms'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
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
      const { submitHandshake } = await import('@/lib/api/handshakes')
      const { raiseException } = await import('@/lib/api/exceptions')
      let resolveSubmit!: () => void
      vi.mocked(submitHandshake).mockImplementationOnce(
        () => new Promise((resolve) => { resolveSubmit = () => resolve({ ok: true, eventHash: 'abc', trip: null }) }),
      )

      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))

      // Start a flush that hangs on the handshake send, then enqueue a second entry
      // mid-flight — exactly what happens when a driver logs an exception while a
      // queued photo upload is replaying in the background.
      const flushPromise = result.current.flush()
      act(() => result.current.enqueueException('trip-2', { exception_type: 'panic_button', description: 'x' }))

      await act(async () => {
        resolveSubmit()
        await flushPromise
      })

      // The handshake entry flushed away; the mid-flush exception must survive in
      // storage rather than being erased by the flush's final write.
      expect(result.current.queueLength).toBe(1)
      const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ kind: string; tripId: string }>
      expect(stored).toHaveLength(1)
      expect(stored[0].kind).toBe('exception')
      expect(stored[0].tripId).toBe('trip-2')
      // The hung send resolved successfully — it must not have been re-sent, and the
      // mid-flush exception must not have been sent by THIS flush (its snapshot
      // predates the enqueue).
      expect(submitHandshake).toHaveBeenCalledTimes(1)
      expect(raiseException).not.toHaveBeenCalled()
    })

    it('guards against overlapping flush runs — a second concurrent call is a no-op while one is in flight', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      let resolveSubmit!: () => void
      vi.mocked(submitHandshake).mockImplementationOnce(
        () => new Promise((resolve) => { resolveSubmit = () => resolve({ ok: true, eventHash: 'abc', trip: null }) }),
      )

      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))

      // Kick off a flush that will hang on the in-flight submitHandshake call, then fire a
      // second flush before the first resolves — the guard should make the second call a
      // pure no-op rather than re-sending the same entry concurrently.
      let firstFlushDone = false
      const firstFlush = result.current.flush().then(() => { firstFlushDone = true })
      await act(() => result.current.flush())

      expect(firstFlushDone).toBe(false)
      expect(submitHandshake).toHaveBeenCalledTimes(1)

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
      const { submitHandshake } = await import('@/lib/api/handshakes')
      let resolveSubmit!: () => void
      vi.mocked(submitHandshake).mockImplementationOnce(
        () => new Promise((resolve) => { resolveSubmit = () => resolve({ ok: true, eventHash: 'abc', trip: null }) }),
      )

      // Two concurrently-mounted instances — banner + page, exactly the production shape.
      const first = renderHook(() => useOfflineQueue())
      const second = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => first.result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))

      // Instance A's flush hangs on the in-flight send; instance B's flush must be a
      // pure no-op against the shared module-scope mutex, not a concurrent re-send.
      let firstFlushDone = false
      const firstFlush = first.result.current.flush().then(() => { firstFlushDone = true })
      await act(() => second.result.current.flush())

      expect(firstFlushDone).toBe(false)
      expect(submitHandshake).toHaveBeenCalledTimes(1)

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

      act(() => first.result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))

      expect(second.result.current.queueLength).toBe(1)
    })
  })

  // Fix 3b: terminal drops used to be console.warn-only — invisible to the driver even
  // though their captured evidence was permanently discarded.
  describe('drop notifications', () => {
    it('a non-409 terminal drop increments droppedCount, and dismissDropped clears it', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      vi.mocked(submitHandshake).mockRejectedValueOnce(new ApiError(422, 'invalid evidence'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
      await act(() => result.current.flush())

      expect(result.current.queueLength).toBe(0)
      expect(result.current.droppedCount).toBe(1)

      act(() => result.current.dismissDropped())

      expect(result.current.droppedCount).toBe(0)
    })

    it('a 409 drop stays silent — the earlier attempt already succeeded server-side', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      vi.mocked(submitHandshake).mockRejectedValueOnce(new ApiError(409, 'already submitted'))
      const { result } = renderHook(() => useOfflineQueue())
      await act(() => Promise.resolve())

      act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
      await act(() => result.current.flush())

      // Dropped from the queue (correct — the evidence landed on a prior attempt),
      // but with no driver-facing notification.
      expect(result.current.queueLength).toBe(0)
      expect(result.current.droppedCount).toBe(0)
    })
  })
})
