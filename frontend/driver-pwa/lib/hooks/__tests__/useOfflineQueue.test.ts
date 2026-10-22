// frontend/driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useOfflineQueue, __resetOfflineQueueStoreForTests } from '../useOfflineQueue'
import { ApiError } from '@/lib/api/client'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'
import type { DriverPosition } from '@/lib/types/location'
import type { ActivationEvidence, LoadingEvidence } from '@/lib/types/evidence-draft'
import type { CheckpointEvidence } from '@/lib/api/checkpoints'
import {
  __setIndexedDbForTests,
  getExceptionEnvelope,
  listExceptionEnvelopes,
  removeExceptionEnvelope,
  saveExceptionEnvelope,
  type ExceptionEnvelope,
} from '@/lib/offline/exception-store'
import { __resetExceptionSyncForTests } from '@/lib/offline/exception-sync'
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/lib/offline/testing/fake-indexeddb'

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
// An exception's photos upload at send time, before the report that cites them.
vi.mock('@/lib/api/artifacts', () => ({
  uploadArtifact: vi.fn().mockResolvedValue({ id: 'artifact-1', file_hash: 'abc' }),
}))

// Exception reports live in IndexedDB now. jsdom has none, so the REAL store runs against
// the hand-written fake; swapping in a fresh one per test is the "app restart" boundary.
let idb: FakeIndexedDbFactory

// Every fake-IDB operation takes a real macrotask, so a mounted hook's own mount-time flush
// is still running for a few ms after render. Waiting it out keeps the tests' explicit
// flush() calls from silently no-op'ing against the module-wide flush mutex.
const SETTLE_MS = 60

async function settle(): Promise<void> {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS)))
}

async function renderQueue() {
  const rendered = renderHook(() => useOfflineQueue())
  await settle()
  return rendered
}

// Clear mock call history too — flush() also runs on every mount, so call counts
// would otherwise accumulate across tests.
// (clearAllMocks keeps the module-level mockResolvedValue implementations intact.)
// The module-scope store reset must run AFTER localStorage.clear() — it recomputes
// queue length from storage, so the order guarantees each test starts at length 0
// with no leftover droppedCount or stuck flush mutex from a prior test.
beforeEach(() => {
  localStorage.clear()
  idb = createFakeIndexedDb()
  __setIndexedDbForTests(idb)
  __resetExceptionSyncForTests()
  __resetOfflineQueueStoreForTests()
  vi.clearAllMocks()
  bindActorLease('driver-1', invalidateActorLease())
})

afterEach(() => {
  __setIndexedDbForTests(null)
})

const EVIDENCE: ActivationEvidence = {
  capturedAt: '2026-06-12T10:00:00Z',
}

// Queued WITH the entry, not re-taken at replay: the fix must say where the driver was
// when they swiped, not where they were when signal came back.
const POSITION: DriverPosition = { lat: -26.09, lng: 28.13, accuracyM: 8 }

// The instant the caller stamped the submission — stored WITH the queue entry
// for the same reason POSITION above is.
const DRIVER_CAPTURED_AT = '2026-06-12T10:00:00Z'

const CHECKPOINT_EVIDENCE: CheckpointEvidence = {
  gpsLat: -29.85, gpsLng: 31.02,
  selfieDataUrl: 'data:img/selfie', cargoPhotoDataUrl: 'data:img/cargo',
  note: '', isDeviation: false, capturedAt: '2026-06-12T10:00:00Z',
}

describe('useOfflineQueue', () => {
  it('starts with empty queue', async () => {
    const { result } = await renderQueue()
    expect(result.current.queueLength).toBe(0)
  })

  it('enqueuePhase increments queueLength and persists to localStorage', async () => {
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].tripId).toBe('trip-1')
    expect(stored[0].phaseEventId).toBe('phase-event-1')
    expect(stored[0].phaseType).toBe('activation')
  })

  // The entry's own id (generated once, at enqueue time) IS the idempotency
  // key sent to the server — proving that wiring here, at the point the entry is built.
  it('enqueuePhase stamps the entry id as its own idempotencyKey', async () => {
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].idempotencyKey).toBe(stored[0].id)
    expect(typeof stored[0].idempotencyKey).toBe('string')
    expect(stored[0].idempotencyKey.length).toBeGreaterThan(0)
  })

  it('flush calls submitPhase for each entry and clears the queue', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
    await act(() => result.current.flush())
    expect(submitPhase).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
  })

  it('replays a legacy phase envelope that has no acknowledgement field', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    localStorage.setItem('fp_offline_queue', JSON.stringify([{
      kind: 'phase',
      id: 'legacy-phase-entry',
      actorId: 'driver-1',
      custodySequence: null,
      tripId: 'trip-1',
      phaseEventId: 'phase-event-1',
      phaseType: 'activation',
      evidence: EVIDENCE,
      idempotencyKey: 'legacy-phase-entry',
      position: POSITION,
      driverCapturedAt: DRIVER_CAPTURED_AT,
      enqueuedAt: '2026-06-12T10:00:01Z',
    }]))
    __resetOfflineQueueStoreForTests()
    const { result } = await renderQueue()

    await act(() => result.current.flush())

    expect(submitPhase).toHaveBeenCalledWith(
      'trip-1', 'phase-event-1', 'activation', EVIDENCE, 'legacy-phase-entry', POSITION,
      DRIVER_CAPTURED_AT, null, null,
    )
    expect(result.current.queueLength).toBe(0)
  })

  // The same idempotency_key must reach the server on a retry as on the
  // first attempt — a queued entry is never rebuilt with a fresh key between flushes.
  it('sends the same idempotency_key on a retry as on the first attempt', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(0, 'timed out'))
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))

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
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))

    await act(() => result.current.flush())

    expect(submitPhase).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
    expect(result.current.droppedCount).toBe(0)

    // A second flush pass with nothing left queued must not re-send anything — proves
    // the completed replay was truly disposed of, not left half-resolved.
    await act(() => result.current.flush())
    expect(submitPhase).toHaveBeenCalledTimes(1)
  })

  it('enqueueException_persists_envelope_in_indexeddb_and_counts_it', async () => {
    const { result } = await renderQueue()

    let outcome: Awaited<ReturnType<typeof result.current.enqueueException>> | undefined
    await act(async () => {
      outcome = await result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' })
    })

    expect(outcome).toEqual({ persisted: true, photoCount: 0 })
    expect(result.current.queueLength).toBe(1)
    const envelopes = await listExceptionEnvelopes()
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]).toMatchObject({ tripId: 'trip-1', status: 'pending', photos: [] })
    // Custody migration may create an empty queue, but report bytes only live in IndexedDB.
    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([])
  })

  it('enqueueException_reports_not_persisted_when_store_refuses', async () => {
    const { result } = await renderQueue()
    idb.failPuts()

    let outcome: Awaited<ReturnType<typeof result.current.enqueueException>> | undefined
    await act(async () => {
      outcome = await result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' })
    })

    // The panic page keys its "could not save" state off this, so it must stay false.
    expect(outcome).toEqual({ persisted: false, photoCount: 0 })
    expect(result.current.queueLength).toBe(0)
    expect(await listExceptionEnvelopes()).toEqual([])
  })

  // The entry's own report id (generated once, at enqueue time) IS the client_report_id
  // sent to the server — the exception counterpart to enqueuePhase's idempotencyKey test.
  it('enqueueException stamps the envelope key as its own client_report_id', async () => {
    const { result } = await renderQueue()
    await act(async () => {
      await result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' })
    })

    const [envelope] = await listExceptionEnvelopes()

    expect(typeof envelope.clientReportId).toBe('string')
    expect(envelope.body.client_report_id).toBe(envelope.clientReportId)
  })

  it('panic_body_with_no_photos_still_enqueues_and_flushes_via_raiseException', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { raiseException } = await import('@/lib/api/exceptions')
    const { result } = await renderQueue()
    await act(async () => {
      await result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' })
    })

    await act(() => result.current.flush())

    expect(uploadArtifact).not.toHaveBeenCalled()
    // A photo-less report carries neither photo field.
    expect(raiseException).toHaveBeenCalledWith('trip-1', {
      exception_type: 'panic_button', description: 'x', client_report_id: expect.any(String),
    })
    expect(result.current.queueLength).toBe(0)
    expect(await listExceptionEnvelopes()).toEqual([])
  })

  // Trailer analytics: the driver's "truck or trailer" answer rides in the body, so a
  // breakdown queued in a dead zone reaches the server with it, unchanged.
  it('keeps a breakdown\'s vehicle answer through the queue unchanged', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    const { result } = await renderQueue()
    await act(async () => {
      await result.current.enqueueException('trip-1', {
        exception_type: 'mechanical', description: 'x', vehicle_type: 'trailer', trailer_id: 'trailer-2',
      })
    })
    const [stored] = await listExceptionEnvelopes()

    await act(() => result.current.flush())

    expect(stored.body).toMatchObject({ vehicle_type: 'trailer', trailer_id: 'trailer-2' })
    expect(raiseException).toHaveBeenCalledWith('trip-1', {
      exception_type: 'mechanical', description: 'x', client_report_id: expect.any(String),
      vehicle_type: 'trailer', trailer_id: 'trailer-2',
    })
  })

  // A lost response (or a retry the driver's app fires while an earlier
  // attempt is still in flight) must resend the SAME client_report_id, exactly like
  // enqueuePhase's idempotencyKey — proving the exception path was wired the same way.
  it('resends the same client_report_id on a retry after a lost response', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(raiseException).mockRejectedValueOnce(new ApiError(0, 'timed out'))
    const { result } = await renderQueue()
    await act(async () => {
      await result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' })
    })

    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1) // transient — still queued

    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(0) // second attempt succeeds

    expect(raiseException).toHaveBeenCalledTimes(2)
    const firstBody = vi.mocked(raiseException).mock.calls[0][1]
    const secondBody = vi.mocked(raiseException).mock.calls[1][1]
    expect(firstBody.client_report_id).toBe(secondBody.client_report_id)
  })

  it('flush retains a failed entry in the queue and keeps unrelated entries', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new Error('network down'))
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  it('flush retains a terminal 4xx failure for review instead of retrying it forever', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(422, 'invalid evidence'))
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(0)
    expect(result.current.attentionCount).toBe(1)
    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([
      expect.objectContaining({ status: 'needs-attention', evidence: EVIDENCE,
        attention: expect.objectContaining({ status: 422, reason: 'invalid evidence' }) }),
    ])
    await act(() => result.current.flush())
    expect(submitPhase).toHaveBeenCalledTimes(1)
  })

  it('flush retains an entry on a 5xx ApiError so it can be retried later', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(503, 'service unavailable'))
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  it('keeps a rate-limited report and retries it after Retry-After elapses', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(raiseException).mockRejectedValueOnce(new ApiError(429, 'slow down', 1_000))
    const { result } = await renderQueue()
    await act(async () => {
      await result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'Driver panic' })
    })
    // Fake timers only from here: the fake IndexedDB schedules its work on setTimeout, so
    // every step below advances the clock to let that work run.
    vi.useFakeTimers()
    try {
      const firstFlush = result.current.flush()
      await act(() => vi.advanceTimersByTimeAsync(100))
      await firstFlush

      expect(result.current.queueLength).toBe(1)
      expect(raiseException).toHaveBeenCalledTimes(1)

      await act(() => vi.advanceTimersByTimeAsync(898))
      expect(raiseException).toHaveBeenCalledTimes(1)

      await act(() => vi.advanceTimersByTimeAsync(2))
      await act(() => vi.advanceTimersByTimeAsync(100))
      expect(raiseException).toHaveBeenCalledTimes(2)
      expect(result.current.queueLength).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // Fix 3: checkpoints now enqueue and replay through the same offline-queue contract
  // as phases and exceptions.
  it('enqueueCheckpoint increments queueLength and persists to localStorage', async () => {
    const { result } = await renderQueue()
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].kind).toBe('checkpoint')
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('enqueueCheckpoint reports whether the checkpoint was stored', async () => {
    const { result } = await renderQueue()

    let stored: boolean | undefined
    act(() => { stored = result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE) })

    expect(stored).toBe(true)
    expect(result.current.queueLength).toBe(1)
  })

  it('enqueueCheckpoint returns false, and queues nothing, when storage refuses the write', async () => {
    const { result } = await renderQueue()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let stored: boolean | undefined
    act(() => { stored = result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE) })
    setItem.mockRestore()
    warn.mockRestore()

    expect(stored).toBe(false)
    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([])
  })

  it('enqueueLocation reports whether the batch was stored', async () => {
    const { result } = await renderQueue()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let stored: boolean | undefined
    act(() => { stored = result.current.enqueueLocation('trip-1', []) })
    setItem.mockRestore()
    warn.mockRestore()

    expect(stored).toBe(false)
  })

  it('flush calls submitCheckpoint for a queued checkpoint and clears the queue', async () => {
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    const { result } = await renderQueue()
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    await act(() => result.current.flush())
    expect(submitCheckpoint).toHaveBeenCalledWith('trip-1', { ...CHECKPOINT_EVIDENCE, custodySequence: null })
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains a queued checkpoint on a 5xx ApiError so it can be retried later', async () => {
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    vi.mocked(submitCheckpoint).mockRejectedValueOnce(new ApiError(503, 'service unavailable'))
    const { result } = await renderQueue()
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
        actorId: 'driver-1', custodySequence: null,
        phaseType: 'activation', evidence: EVIDENCE, idempotencyKey: 'entry-1',
        enqueuedAt: '2026-06-12T10:00:00Z',
      }]))

      const { result } = await renderQueue()

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.queueLength).toBe(0))
    })

    it('flushes when the document becomes visible again', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      const { result } = await renderQueue()
      // Let the mount-time flush (empty queue, no-op) settle before seeding the queue.
      await settle()

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
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
      const { result } = await renderQueue()
      await settle()

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
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
      const { result } = await renderQueue()
      await settle()

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
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

      const { result } = await renderQueue()

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))

      // Start a flush that hangs on the phase send, then enqueue a second entry
      // mid-flight — exactly what happens when a driver logs an exception while a
      // queued photo upload is replaying in the background.
      const flushPromise = result.current.flush()
      await act(async () => {
        await result.current.enqueueException('trip-2', { exception_type: 'panic_button', description: 'x' })
      })

      await act(async () => {
        resolveSubmit()
        await flushPromise
      })

      // The phase entry flushed away; the mid-flush exception must survive rather than
      // being erased by the flush's final write.
      expect(result.current.queueLength).toBe(1)
      const envelopes = await listExceptionEnvelopes()
      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].tripId).toBe('trip-2')
      expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([])
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

      const { result } = await renderQueue()
      await settle()

      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))

      // Kick off a flush that will hang on the in-flight submitPhase call, then fire a
      // second flush before the first resolves — the guard should make the second call a
      // pure no-op rather than re-sending the same entry concurrently.
      let firstFlushDone = false
      const firstFlush = result.current.flush().then(() => { firstFlushDone = true })
      // The exception store is read before the phase send, so wait until the flush is
      // genuinely mid-send before racing it.
      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
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
      const first = await renderQueue()
      const second = await renderQueue()
      await settle()

      act(() => first.result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))

      // Instance A's flush hangs on the in-flight send; instance B's flush must be a
      // pure no-op against the shared module-scope mutex, not a concurrent re-send.
      let firstFlushDone = false
      const firstFlush = first.result.current.flush().then(() => { firstFlushDone = true })
      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
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
      const first = await renderQueue()
      const second = await renderQueue()
      await settle()

      act(() => first.result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))

      expect(second.result.current.queueLength).toBe(1)
    })
  })

  describe('refused phase retention', () => {
    it('a terminal refusal remains stored even when the obsolete drop notice is dismissed', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(422, 'invalid evidence'))
      const { result } = await renderQueue()
      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
      await act(() => result.current.flush())

      expect(result.current.queueLength).toBe(0)
      expect(result.current.attentionCount).toBe(1)
      expect(result.current.droppedCount).toBe(0)
      act(() => result.current.dismissDropped())
      expect(result.current.attentionCount).toBe(1)
      expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([
        expect.objectContaining({ status: 'needs-attention', actorId: 'driver-1', evidence: EVIDENCE }),
      ])
    })

    it('an uncoded 409 is retained instead of assuming an earlier attempt succeeded', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(409, 'already submitted'))
      const { result } = await renderQueue()
      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
      await act(() => result.current.flush())

      expect(result.current.queueLength).toBe(0)
      expect(result.current.attentionCount).toBe(1)
      expect(result.current.droppedCount).toBe(0)
      expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([
        expect.objectContaining({ status: 'needs-attention', evidence: EVIDENCE }),
      ])
    })

    it('only a coded duplicate clears the acknowledged capture', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(409, 'Already recorded', undefined, {
        code: 'EVIDENCE_ALREADY_RECORDED', requestId: null, currentVersion: null, evidenceId: 'receipt-1',
      }))
      const { result } = await renderQueue()
      act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
      await act(() => result.current.flush())

      expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([])
      expect(result.current.attentionCount).toBe(0)
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
      const { result } = await renderQueue()
      await settle()

      act(() => {
        result.current.enqueuePhase('trip-1', 'phase-event-in-transit', 'in_transit', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
        result.current.enqueuePhase('trip-1', 'phase-event-unloading', 'unloading', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
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
      const { result } = await renderQueue()
      await settle()

      act(() => {
        result.current.enqueuePhase('trip-1', 'phase-event-in-transit', 'in_transit', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
        result.current.enqueuePhase('trip-2', 'phase-event-unloading', 'unloading', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
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
      const { result } = await renderQueue()

      await act(async () => {
        result.current.enqueuePhase('trip-1', 'phase-event-in-transit', 'in_transit', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
        await result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' })
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

// The linehaul PDF wraps the same JPEG as the scan, so it roughly doubles a loading entry.
// The scan is the evidence; when storage refuses both, the queue keeps the scan.
describe('queued loading with a linehaul PDF', () => {
  const LOADING: LoadingEvidence = {
    linehaulPhotoDataUrl: 'data:image/jpeg;base64,/9j/SCAN', linehaulPhotoArtifactId: null,
    linehaulPdfDataUrl: 'data:application/pdf;base64,JVBERi0=', linehaulPdfArtifactId: 'pdf-early',
    capturedAt: '2026-06-12T10:05:00Z',
  }

  it('keeps the scan and drops the PDF image when the entry will not fit in storage', async () => {
    const { result } = await renderQueue()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw new Error('QuotaExceededError') })

    act(() => result.current.enqueuePhase('trip-1', 'phase-event-2', 'loading', LOADING, POSITION, DRIVER_CAPTURED_AT))

    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].evidence.linehaulPhotoDataUrl).toBe(LOADING.linehaulPhotoDataUrl)
    expect(stored[0].evidence.linehaulPdfDataUrl).toBeNull()
    // An id the early upload already produced costs nothing to keep.
    expect(stored[0].evidence.linehaulPdfArtifactId).toBe('pdf-early')
    expect(result.current.queueLength).toBe(1)
    setItem.mockRestore()
  })

  it('stores the PDF image when it fits', () => {
    const { result } = renderHook(() => useOfflineQueue())

    act(() => result.current.enqueuePhase('trip-1', 'phase-event-2', 'loading', LOADING, POSITION, DRIVER_CAPTURED_AT))

    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].evidence.linehaulPdfDataUrl).toBe(LOADING.linehaulPdfDataUrl)
  })
})

// A report's photos travel as Blobs inside an IndexedDB envelope (localStorage cannot hold
// them), uploaded at send time and cited by the report as one complete, ordered id list.

function dataUrl(label: string): string {
  return `data:image/jpeg;base64,${btoa(label)}`
}

function photoInput(label: string) {
  return { dataUrl: dataUrl(label), capturedAt: `2026-09-05T09:00:0${label.length % 10}Z` }
}

function envelopeFixture(overrides: Partial<ExceptionEnvelope> & { clientReportId: string }): ExceptionEnvelope {
  return {
    tripId: 'trip-1',
    actorId: 'driver-1',
    body: { exception_type: 'cargo_damage', description: 'Pallet crushed', client_report_id: overrides.clientReportId },
    photos: [],
    status: 'pending',
    attentionReason: null,
    attentionPhotoId: null,
    createdAt: '2026-09-05T09:00:00.000Z',
    updatedAt: '2026-09-05T09:00:00.000Z',
    ...overrides,
  }
}

const BODY = { exception_type: 'cargo_damage' as const, description: 'Pallet crushed' }

describe('queued exception photos', () => {
  it('stores each photo as a Blob in order, with the time the driver took it', async () => {
    const { result } = await renderQueue()
    const photos = [photoInput('one'), photoInput('three')]

    let outcome: Awaited<ReturnType<typeof result.current.enqueueException>> | undefined
    await act(async () => { outcome = await result.current.enqueueException('trip-1', BODY, photos) })

    expect(outcome).toEqual({ persisted: true, photoCount: 2 })
    const [envelope] = await listExceptionEnvelopes()
    expect(envelope.photos.map((p) => p.capturedAt)).toEqual(photos.map((p) => p.capturedAt))
    expect(envelope.photos.every((p) => p.blob instanceof Blob && p.uploadedArtifactId === null)).toBe(true)
  })

  it('flush_sends_complete_ordered_id_list_and_supporting_artifact_id_equals_first', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(uploadArtifact)
      .mockResolvedValueOnce({ id: 'a1', file_hash: 'h' } as never)
      .mockResolvedValueOnce({ id: 'a2', file_hash: 'h' } as never)
      .mockResolvedValueOnce({ id: 'a3', file_hash: 'h' } as never)
    const { result } = await renderQueue()
    const photos = [photoInput('one'), photoInput('two'), photoInput('three')]
    await act(async () => { await result.current.enqueueException('trip-1', BODY, photos) })

    await act(() => result.current.flush())

    expect(uploadArtifact).toHaveBeenCalledTimes(3)
    expect(vi.mocked(uploadArtifact).mock.calls.map(([arg]) => arg.capturedAt)).toEqual(photos.map((p) => p.capturedAt))
    expect(vi.mocked(uploadArtifact).mock.calls[0][0]).toMatchObject({
      tripId: 'trip-1', artifactType: 'photo', dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    })
    // One POST, complete list, in the driver's order; the legacy single field is the lead photo.
    expect(raiseException).toHaveBeenCalledTimes(1)
    expect(raiseException).toHaveBeenCalledWith('trip-1', {
      ...BODY,
      client_report_id: expect.any(String),
      supporting_artifact_ids: ['a1', 'a2', 'a3'],
      supporting_artifact_id: 'a1',
    })
    expect(result.current.queueLength).toBe(0)
  })

  it('flush_transient_failure_keeps_envelope_and_next_report_still_flows', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(raiseException).mockRejectedValueOnce(new ApiError(503, 'unavailable'))
    const { result } = await renderQueue()
    await saveExceptionEnvelope(envelopeFixture({ clientReportId: 'report-first', createdAt: '2026-09-05T09:00:00.000Z' }))
    await saveExceptionEnvelope(envelopeFixture({ clientReportId: 'report-second', createdAt: '2026-09-05T09:00:01.000Z' }))

    await act(() => result.current.flush())

    // A failing report never blocks the next one.
    expect(raiseException).toHaveBeenCalledTimes(2)
    const remaining = await listExceptionEnvelopes()
    expect(remaining.map((e) => e.clientReportId)).toEqual(['report-first'])
    expect(remaining[0].status).toBe('pending')
    expect(result.current.queueLength).toBe(1)
    expect(result.current.attentionCount).toBe(0)
  })

  it('flush_terminal_rejection_marks_needs_attention_and_other_reports_continue', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(raiseException).mockRejectedValueOnce(new ApiError(422, 'Description too long'))
    const { result } = await renderQueue()
    await saveExceptionEnvelope(envelopeFixture({ clientReportId: 'report-first', createdAt: '2026-09-05T09:00:00.000Z' }))
    await saveExceptionEnvelope(envelopeFixture({ clientReportId: 'report-second', createdAt: '2026-09-05T09:00:01.000Z' }))

    await act(() => result.current.flush())

    expect(raiseException).toHaveBeenCalledTimes(2)
    const rejected = await getExceptionEnvelope('report-first')
    expect(rejected).toMatchObject({ status: 'needs-attention', attentionReason: 'Description too long' })
    expect(await getExceptionEnvelope('report-second')).toBeNull()
    expect(result.current.attentionCount).toBe(1)
    // A needs-attention report is not "waiting to sync": it will not retry by itself.
    expect(result.current.queueLength).toBe(0)
    expect(result.current.droppedCount).toBe(0)
  })

  it('flush_409_is_never_dropped', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(raiseException).mockRejectedValueOnce(new ApiError(409, 'conflict'))
    const { result } = await renderQueue()
    await saveExceptionEnvelope(envelopeFixture({ clientReportId: 'report-first' }))

    await act(() => result.current.flush())

    // The phase queue drops 409s silently; a report must stay visible to the driver.
    expect(await getExceptionEnvelope('report-first')).toMatchObject({ status: 'needs-attention' })
    expect(result.current.attentionCount).toBe(1)
    expect(result.current.droppedCount).toBe(0)
  })

  it('never sends a reduced photo set when the server terminally rejects one photo', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(uploadArtifact)
      .mockResolvedValueOnce({ id: 'a1', file_hash: 'h' } as never)
      .mockRejectedValueOnce(new ApiError(422, 'Unsupported file type'))
    const { result } = await renderQueue()
    await act(async () => {
      await result.current.enqueueException('trip-1', BODY, [photoInput('one'), photoInput('two')])
    })

    await act(() => result.current.flush())

    expect(raiseException).not.toHaveBeenCalled()
    const [envelope] = await listExceptionEnvelopes()
    expect(envelope.status).toBe('needs-attention')
    expect(envelope.attentionPhotoId).toBe(envelope.photos[1].id)
    // Photo 1 already landed and is remembered, so "Try again" will not duplicate it.
    expect(envelope.photos[0].uploadedArtifactId).toBe('a1')
  })

  it('keeps both report and photo when the upload is rate limited', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(uploadArtifact).mockRejectedValueOnce(new ApiError(429, 'slow down', 60_000))
    const { result } = await renderQueue()
    await act(async () => { await result.current.enqueueException('trip-1', BODY, [photoInput('one')]) })

    await act(() => result.current.flush())

    expect(raiseException).not.toHaveBeenCalled()
    expect(result.current.queueLength).toBe(1)

    await act(() => result.current.flush())
    expect(uploadArtifact).toHaveBeenCalledTimes(2)
    expect(raiseException).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
  })

  it('does not re-upload the photo on a retry after the exception POST fails transiently post-upload', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { raiseException } = await import('@/lib/api/exceptions')
    vi.mocked(raiseException).mockRejectedValueOnce(new ApiError(0, 'timed out'))
    const { result } = await renderQueue()
    await act(async () => { await result.current.enqueueException('trip-1', BODY, [photoInput('one')]) })

    await act(() => result.current.flush())

    expect(result.current.queueLength).toBe(1)
    expect(uploadArtifact).toHaveBeenCalledTimes(1)
    // The id is already durable: the next flush must not upload the same image again.
    const [midway] = await listExceptionEnvelopes()
    expect(midway.photos[0].uploadedArtifactId).toBe('artifact-1')

    await act(() => result.current.flush())

    expect(result.current.queueLength).toBe(0)
    expect(uploadArtifact).toHaveBeenCalledTimes(1)
    const firstCall = vi.mocked(raiseException).mock.calls[0][1]
    const secondCall = vi.mocked(raiseException).mock.calls[1][1]
    expect(firstCall.client_report_id).toBe(secondCall.client_report_id)
    expect(secondCall.supporting_artifact_ids).toEqual(['artifact-1'])
  })
})

// Reports queued by the previous build live in localStorage as a single data-URL photo.
// An app update must carry them over without losing or duplicating anything.
describe('legacy localStorage exception entries', () => {
  const LEGACY_WITH_PHOTO = {
    kind: 'exception', id: 'legacy-1', tripId: 'trip-1',
    body: { exception_type: 'cargo_damage', description: 'Crushed', client_report_id: 'legacy-report-1' },
    photoDataUrl: dataUrl('legacy-bytes'), photoCapturedAt: '2026-09-04T08:00:00Z',
    enqueuedAt: '2026-09-04T08:00:05Z',
  }
  const LEGACY_ALREADY_UPLOADED = {
    kind: 'exception', id: 'legacy-2', tripId: 'trip-1',
    body: {
      exception_type: 'mechanical', description: 'Flat', client_report_id: 'legacy-report-2',
      supporting_artifact_id: 'already-uploaded',
    },
    enqueuedAt: '2026-09-04T08:01:00Z',
  }

  function seedLegacy(entries: unknown[]) {
    localStorage.setItem('fp_offline_queue', JSON.stringify(entries))
    __resetOfflineQueueStoreForTests()
  }

  it('legacy_exception_photos_and_known_artifact_ids_migrate_to_quarantine_without_replay', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { raiseException } = await import('@/lib/api/exceptions')
    seedLegacy([LEGACY_WITH_PHOTO, LEGACY_ALREADY_UPLOADED])
    const { result } = await renderQueue()

    await act(() => result.current.flush())

    expect(uploadArtifact).not.toHaveBeenCalled()
    expect(raiseException).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([])
    const envelopes = await listExceptionEnvelopes()
    expect(envelopes).toHaveLength(2)
    expect(envelopes.every((envelope) => envelope.status === 'quarantined' && envelope.actorId === null)).toBe(true)
    const withBytes = envelopes.find((envelope) => envelope.clientReportId === 'legacy-report-1')!
    expect(withBytes.photos[0]).toMatchObject({ blob: expect.any(Blob), capturedAt: LEGACY_WITH_PHOTO.photoCapturedAt })
    expect(withBytes.photos[0].blob?.size).toBe('legacy-bytes'.length)
    expect(envelopes.find((envelope) => envelope.clientReportId === 'legacy-report-2')?.photos[0])
      .toMatchObject({ blob: null, uploadedArtifactId: 'already-uploaded' })
    expect(result.current.queueLength).toBe(0)
    expect(result.current.attentionCount).toBe(2)
  })

  it('legacy_entry_removed_from_localstorage_only_after_envelope_written', async () => {
    // Records when the envelope write is issued and when the legacy entry is dropped.
    const events: string[] = []
    const realOpen = idb.open.bind(idb)
    const observed = {
      open: (name: string, version?: number) => {
        const request = realOpen(name, version)
        let database: IDBDatabase | undefined
        Object.defineProperty(request, 'result', {
          configurable: true,
          get: () => database,
          set: (value: IDBDatabase) => {
            const realTransaction = value.transaction.bind(value)
            value.transaction = (...args: Parameters<IDBDatabase['transaction']>) => {
              const tx = realTransaction(...args)
              const realObjectStore = tx.objectStore.bind(tx)
              tx.objectStore = (storeName: string) => {
                const store = realObjectStore(storeName)
                const realPut = store.put.bind(store)
                store.put = (...putArgs: Parameters<IDBObjectStore['put']>) => {
                  events.push('envelope-put')
                  return realPut(...putArgs)
                }
                return store
              }
              return tx
            }
            database = value
          },
        })
        return request
      },
    }
    __setIndexedDbForTests(observed as unknown as IDBFactory)
    const realSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'fp_offline_queue' && !value.includes('legacy-1')) events.push('legacy-drop')
      return realSetItem.call(this, key, value)
    })
    seedLegacy([LEGACY_WITH_PHOTO])
    // seedLegacy wrote through the spy before any migration ran; ignore that setup write.
    events.length = 0

    try {
      await renderQueue()
    } finally {
      setItem.mockRestore()
    }

    const firstPut = events.indexOf('envelope-put')
    const firstDrop = events.indexOf('legacy-drop')
    expect(firstPut).toBeGreaterThanOrEqual(0)
    expect(firstDrop).toBeGreaterThan(firstPut)
  })

  it('legacy_exception_left_in_localstorage_when_idb_unavailable', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { raiseException } = await import('@/lib/api/exceptions')
    idb.setUnavailable(true)
    seedLegacy([LEGACY_WITH_PHOTO])
    const { result } = await renderQueue()

    await act(() => result.current.flush())

    // Not sendable without the store, and not droppable: it stays exactly as it was.
    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([LEGACY_WITH_PHOTO])
    expect(uploadArtifact).not.toHaveBeenCalled()
    expect(raiseException).not.toHaveBeenCalled()
    expect(result.current.queueLength).toBe(1)
    expect(result.current.droppedCount).toBe(0)
  })

  it('legacy_exception_left_in_localstorage_when_the_store_refuses_the_write', async () => {
    idb.failPuts()
    seedLegacy([LEGACY_WITH_PHOTO])
    const { result } = await renderQueue()

    await act(() => result.current.flush())

    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([LEGACY_WITH_PHOTO])
    expect(result.current.queueLength).toBe(1)
  })

  it('legacy_checkpoint_with_unknown_actor_keeps_its_selfie_in_quarantine', async () => {
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    localStorage.setItem('fp_offline_queue', JSON.stringify([{
      kind: 'checkpoint', id: 'cp-entry', tripId: 'trip-1', evidence: CHECKPOINT_EVIDENCE,
      enqueuedAt: '2026-06-12T10:00:00Z',
    }]))
    __resetOfflineQueueStoreForTests()
    const { result } = await renderQueue()

    await act(() => result.current.flush())

    expect(submitCheckpoint).not.toHaveBeenCalled()
    expect(result.current.queueLength).toBe(0)
    expect(result.current.attentionCount).toBe(1)
    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([
      expect.objectContaining({ status: 'quarantined', actorId: null, evidence: CHECKPOINT_EVIDENCE }),
    ])
  })

  it('phase_checkpoint_location_queues_unchanged', async () => {
    const { result } = await renderQueue()
    // Unmounted flush must not run: assert on what was written, before anything is sent.
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValue(new ApiError(503, 'down'))
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    vi.mocked(submitCheckpoint).mockRejectedValue(new ApiError(503, 'down'))

    act(() => {
      result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
      result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE)
      result.current.enqueueLocation('trip-1', [])
    })

    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ kind: string }>
    expect(stored.map((e) => e.kind)).toEqual(['phase', 'checkpoint', 'location'])
    expect(result.current.queueLength).toBe(3)
    expect(await listExceptionEnvelopes()).toEqual([])
    vi.mocked(submitPhase).mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    vi.mocked(submitCheckpoint).mockResolvedValue({ id: 'cp-1' } as never)
  })
})

describe('submitExceptionReport', () => {
  const DRAFT_BODY = { exception_type: 'cargo_damage' as const, description: 'Pallet crushed' }

  function draft(photoLabels: string[] = [], clientReportId: string = crypto.randomUUID()) {
    return {
      tripId: 'trip-1',
      clientReportId,
      body: { ...DRAFT_BODY, client_report_id: clientReportId },
      photos: photoLabels.map((label) => ({
        id: `photo-${label}`, dataUrl: dataUrl(label), capturedAt: '2026-09-05T09:00:00Z',
      })),
    }
  }

  it('submitExceptionReport_acknowledged_when_post_succeeds', async () => {
    const { result } = await renderQueue()
    const post = vi.fn().mockResolvedValue(undefined)
    const onProgress = vi.fn()

    let outcome: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { outcome = await result.current.submitExceptionReport(draft(['a', 'b']), post, onProgress) })

    expect(outcome).toEqual({ kind: 'acknowledged' })
    expect(post).toHaveBeenCalledWith(['artifact-1', 'artifact-1'])
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]])
    expect(await listExceptionEnvelopes()).toEqual([])
    expect(result.current.queueLength).toBe(0)
  })

  it('submitExceptionReport_saved_for_later_when_post_fails_transiently_and_store_holds_it', async () => {
    const { result } = await renderQueue()
    const post = vi.fn().mockRejectedValue(new ApiError(503, 'unavailable'))

    let outcome: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { outcome = await result.current.submitExceptionReport(draft(['a']), post) })

    expect(outcome).toEqual({ kind: 'saved-for-later' })
    expect(await listExceptionEnvelopes()).toHaveLength(1)
    expect(result.current.queueLength).toBe(1)
  })

  it('submitExceptionReport_not_saved_when_store_refuses_and_post_is_transient', async () => {
    const { result } = await renderQueue()
    idb.failPuts()
    const post = vi.fn().mockRejectedValue(new TypeError('network unreachable'))

    let outcome: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { outcome = await result.current.submitExceptionReport(draft(['a', 'b']), post) })

    expect(outcome).toEqual({ kind: 'not-saved', photoCount: 2 })
    expect(result.current.queueLength).toBe(0)
  })

  it('submitExceptionReport_rejected_names_the_photo_the_server_refused', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    vi.mocked(uploadArtifact)
      .mockResolvedValueOnce({ id: 'a1', file_hash: 'h' } as never)
      .mockRejectedValueOnce(new ApiError(422, 'Unsupported file type'))
    const { result } = await renderQueue()
    const post = vi.fn()

    let outcome: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { outcome = await result.current.submitExceptionReport(draft(['a', 'b', 'c']), post) })

    expect(outcome).toEqual({ kind: 'rejected', reason: 'Unsupported file type', photoIndex: 1 })
    expect(post).not.toHaveBeenCalled()
    expect(result.current.attentionCount).toBe(1)
  })

  it('submitExceptionReport_rejected_without_photo_index_when_the_report_itself_is_refused', async () => {
    const { result } = await renderQueue()
    const post = vi.fn().mockRejectedValue(new ApiError(422, 'Description too long'))

    let outcome: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { outcome = await result.current.submitExceptionReport(draft([]), post) })

    expect(outcome).toEqual({ kind: 'rejected', reason: 'Description too long', photoIndex: null })
  })

  it('durable_resubmit_after_photo3_rejected_does_not_reupload_photos_1_and_2', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    vi.mocked(uploadArtifact)
      .mockResolvedValueOnce({ id: 'a1', file_hash: 'h' } as never)
      .mockResolvedValueOnce({ id: 'a2', file_hash: 'h' } as never)
      .mockRejectedValueOnce(new ApiError(422, 'Unsupported file type'))
    const { result } = await renderQueue()
    const post = vi.fn().mockResolvedValue(undefined)
    const full = draft(['a', 'b', 'c'], 'resubmit-report')
    const without3 = { ...full, photos: full.photos.slice(0, 2) }

    let first: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    let second: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { first = await result.current.submitExceptionReport(full, post) })
    await act(async () => { second = await result.current.submitExceptionReport(without3, post) })

    expect(first).toMatchObject({ kind: 'rejected', photoIndex: 2 })
    expect(second).toEqual({ kind: 'acknowledged' })
    // 3 uploads in total (a, b, the rejected c) - never 5.
    expect(uploadArtifact).toHaveBeenCalledTimes(3)
    expect(post).toHaveBeenCalledWith(['a1', 'a2'])
  })

  it('overlapping_submission_waits_so_the_older_ack_cannot_delete_the_newer_draft', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    vi.mocked(uploadArtifact).mockResolvedValue({ id: 'art', file_hash: 'h' } as never)
    const { result } = await renderQueue()
    const reportId = 'overlap-report'
    let releaseFirstPost: () => void = () => {}
    const firstPost = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { releaseFirstPost = resolve }))
    const secondPost = vi.fn().mockResolvedValue(undefined)

    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    await act(async () => {
      first = result.current.submitExceptionReport(draft(['a'], reportId), firstPost)
      await waitFor(() => expect(firstPost).toHaveBeenCalled())
      // Newer draft of the same report, with an extra photo, arrives mid-send.
      second = result.current.submitExceptionReport(draft(['a', 'b'], reportId), secondPost)
      await new Promise((resolve) => setTimeout(resolve, 30))
      // It must not have been saved over the one still being sent.
      expect((await getExceptionEnvelope(reportId))?.photos).toHaveLength(1)
      releaseFirstPost()
      await Promise.all([first, second])
    })

    // The older send acknowledged its own revision only; the newer draft was then saved and sent.
    expect(secondPost).toHaveBeenCalledTimes(1)
    expect(await first).toEqual({ kind: 'acknowledged' })
    expect(await second).toEqual({ kind: 'acknowledged' })
  })

  it('submitExceptionReport_rejects_an_unreadable_photo_instead_of_throwing', async () => {
    const { result } = await renderQueue()
    const bad = draft(['a', 'b'])
    bad.photos[1] = { ...bad.photos[1], dataUrl: 'not-a-data-url' }
    const post = vi.fn()

    let outcome: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { outcome = await result.current.submitExceptionReport(bad, post) })

    expect(outcome).toEqual({ kind: 'rejected', reason: 'photo could not be read', photoIndex: 1 })
    expect(post).not.toHaveBeenCalled()
  })

  it('submitExceptionReport_resumes_after_not_saved_without_reupload', async () => {
    const { uploadArtifact } = await import('@/lib/api/artifacts')
    const { result } = await renderQueue()
    idb.failPuts()
    const sameDraft = draft(['a'])
    const post = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unreachable'))
      .mockResolvedValueOnce(undefined)

    let first: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    let second: Awaited<ReturnType<typeof result.current.submitExceptionReport>> | undefined
    await act(async () => { first = await result.current.submitExceptionReport(sameDraft, post) })
    await act(async () => { second = await result.current.submitExceptionReport(sameDraft, post) })

    expect(first).toEqual({ kind: 'not-saved', photoCount: 1 })
    expect(second).toEqual({ kind: 'acknowledged' })
    // Progress survived in memory under the same clientReportId: the photo went up once.
    expect(uploadArtifact).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe('flush uses fresh envelopes', () => {
  it('skips a report that was removed while an earlier report was sending', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    let release!: () => void
    vi.mocked(raiseException).mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ id: 'exc-1' } as never) }),
    )
    const { result } = await renderQueue()
    await saveExceptionEnvelope(envelopeFixture({ clientReportId: 'report-first', createdAt: '2026-09-05T09:00:00.000Z' }))
    await saveExceptionEnvelope(envelopeFixture({ clientReportId: 'report-second', createdAt: '2026-09-05T09:00:01.000Z' }))

    const flushing = result.current.flush()
    await waitFor(() => expect(raiseException).toHaveBeenCalledTimes(1))
    // Another path (e.g. the page) finished the second report while the first was in flight.
    await removeExceptionEnvelope('report-second')
    await act(async () => {
      release()
      await flushing
    })

    expect(raiseException).toHaveBeenCalledTimes(1)
  })
})

describe('needs-attention reports', () => {
  async function seedAttention(): Promise<void> {
    await saveExceptionEnvelope(envelopeFixture({
      clientReportId: 'report-attention', status: 'needs-attention', attentionReason: 'Description too long',
    }))
  }

  it('counts reports that need attention without counting them as waiting to sync', async () => {
    await seedAttention()
    const { result } = await renderQueue()

    expect(result.current.attentionCount).toBe(1)
    expect(result.current.queueLength).toBe(0)
  })

  it('retryAttention resets and flushes', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    await seedAttention()
    const { result } = await renderQueue()
    expect(raiseException).not.toHaveBeenCalled()

    await act(() => result.current.retryAttention())

    expect(raiseException).toHaveBeenCalledTimes(1)
    expect(await listExceptionEnvelopes()).toEqual([])
    expect(result.current.attentionCount).toBe(0)
  })

  it('dismissAttention removes', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    await seedAttention()
    const { result } = await renderQueue()

    await act(() => result.current.dismissAttention())

    expect(await listExceptionEnvelopes()).toEqual([])
    expect(result.current.attentionCount).toBe(0)
    expect(raiseException).not.toHaveBeenCalled()
  })
})
it('stops_after_account_generation_changes', async () => {
  const actor = await import('@/lib/session/custody-context')
  const { submitPhase } = await import('@/lib/api/phases')
  const actorId = crypto.randomUUID()
  actor.bindActorLease(actorId, actor.invalidateActorLease())
  const { result } = await renderQueue()
  vi.mocked(submitPhase).mockReset()
  act(() => {
    result.current.enqueuePhase('trip-1', 'phase-one', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
    result.current.enqueuePhase('trip-1', 'phase-two', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
  })
  let release!: (value: { ok: true; trip: null; phaseStatus: 'completed' }) => void
  vi.mocked(submitPhase).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  const flushing = result.current.flush()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  actor.bindActorLease(crypto.randomUUID(), actor.invalidateActorLease())
  actor.bindActorLease(actorId, actor.invalidateActorLease())
  release({ ok: true, trip: null, phaseStatus: 'completed' })
  await flushing
  expect(submitPhase).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([
    expect.objectContaining({ phaseEventId: 'phase-two', actorId }),
  ])
  actor.invalidateActorLease()
})

// A queued capture the dispatcher already closed (backend A1: 409 PHASE_OVERRIDDEN). It must be
// kept for the driver, but the server treats an overridden row as resolved, so it must NOT stall
// the later phases of the same trip the way an unresolved earlier phase does.
describe('queued capture for an overridden phase', () => {
  const overriddenError = () => new ApiError(409, 'The dispatcher closed this step while your capture was waiting. It is kept on this phone.', undefined, {
    code: 'PHASE_OVERRIDDEN', requestId: null, currentVersion: null, evidenceId: null,
  })

  it('keeps the entry as needs-attention with the server reason', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(overriddenError())
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))

    await act(() => result.current.flush())

    expect(result.current.queueLength).toBe(0)
    expect(result.current.attentionCount).toBe(1)
    expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([
      expect.objectContaining({
        status: 'needs-attention', evidence: EVIDENCE,
        attention: expect.objectContaining({ code: 'PHASE_OVERRIDDEN', lateEligible: false, reason: expect.stringContaining('kept on this phone') }),
      }),
    ])
  })

  it('still sends the next phase for the same trip in the same pass', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(overriddenError())
    const { result } = await renderQueue()
    act(() => {
      result.current.enqueuePhase('trip-1', 'phase-event-activation', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
      result.current.enqueuePhase('trip-1', 'phase-event-loading', 'loading', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
    })

    await act(() => result.current.flush())

    expect(submitPhase).toHaveBeenCalledTimes(2)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ phaseType: string; status: string }>
    expect(stored.map((entry) => [entry.phaseType, entry.status])).toEqual([['activation', 'needs-attention']])
  })

  it('still stalls the next phase for the same trip after any other retained refusal', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(new ApiError(409, 'Captured before the handover', undefined, {
      code: 'CUSTODY_CONTEXT_CHANGED', requestId: null, currentVersion: null, evidenceId: null,
    }))
    const { result } = await renderQueue()
    act(() => {
      result.current.enqueuePhase('trip-1', 'phase-event-activation', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
      result.current.enqueuePhase('trip-1', 'phase-event-loading', 'loading', EVIDENCE, POSITION, DRIVER_CAPTURED_AT)
    })

    await act(() => result.current.flush())

    expect(submitPhase).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]') as Array<{ phaseType: string }>
    expect(stored.map((entry) => entry.phaseType)).toEqual(['activation', 'loading'])
  })

  it('"Try again" does not put an overridden capture back in the send queue', async () => {
    const { submitPhase } = await import('@/lib/api/phases')
    vi.mocked(submitPhase).mockRejectedValueOnce(overriddenError())
    const { result } = await renderQueue()
    act(() => result.current.enqueuePhase('trip-1', 'phase-event-1', 'activation', EVIDENCE, POSITION, DRIVER_CAPTURED_AT))
    await act(() => result.current.flush())

    await act(() => result.current.retryAttention())

    expect(submitPhase).toHaveBeenCalledTimes(1)
    expect(result.current.attentionCount).toBe(1)
  })
})
