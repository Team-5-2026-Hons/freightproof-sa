import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { useOfflineQueue, __resetOfflineQueueStoreForTests } from '@/lib/hooks/useOfflineQueue'
import { loadQueue } from '@/lib/offline/queue-storage'
import { __setIndexedDbForTests } from '@/lib/offline/exception-store'
import { createFakeIndexedDb } from '@/lib/offline/testing/fake-indexeddb'
import { authenticateTestDriver } from '@/lib/session/testing/custody'
import { startPhaseSubmission, __resetPhaseSubmitterForTests } from '../phase-submitter'

// Keep submitPhase, the artifact resolver, and the multipart upload real. Only the
// HTTP boundary is replaced, so an artifact receipt cannot masquerade as a phase receipt.
const http = vi.hoisted(() => ({ post: vi.fn(), postForm: vi.fn() }))
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
vi.mock('@/lib/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>()
  return { ...actual, api: { ...actual.api, post: http.post, postForm: http.postForm } }
})

const capturedAt = '2026-10-20T10:00:00.000Z'
const evidence = { linehaulPhotoDataUrl: 'data:image/jpeg;base64,Ynl0ZXM=', linehaulPhotoArtifactId: null, capturedAt }
const phaseKey = 'original-phase-key'
const custody = { actorId: 'driver-1', custodySequence: 0 }

function duplicate(evidenceId: string | null): ApiError {
  return new ApiError(409, 'Already recorded', undefined, {
    code: 'EVIDENCE_ALREADY_RECORDED', requestId: null, currentVersion: null, evidenceId,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  __setIndexedDbForTests(createFakeIndexedDb())
  __resetOfflineQueueStoreForTests()
  __resetPhaseSubmitterForTests()
  authenticateTestDriver('trip', 0)
  // jsdom requires its own Blob for FormData; the production conversion still runs.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) }))
  http.postForm.mockReset().mockRejectedValue(duplicate('artifact-receipt'))
  http.post.mockReset()
})
afterEach(() => { vi.unstubAllGlobals(); __setIndexedDbForTests(null) })

it.each([
  ['live', 'refused'], ['live', 'recorded'], ['queue', 'refused'], ['queue', 'recorded'],
] as const)('%s waits for the phase key acknowledgement after an artifact receipt: %s', async (path, completion) => {
  const { result } = renderHook(() => useOfflineQueue())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); await result.current.flush() })
  let rejectCompletion!: (error: ApiError) => void
  http.post.mockImplementation(() => new Promise((_resolve, reject) => { rejectCompletion = reject }))
  const onOutcome = vi.fn()
  act(() => {
    if (path === 'live') {
      startPhaseSubmission({ tripId: 'trip', phaseEventId: 'phase', phaseType: 'loading', evidence,
        idempotencyKey: phaseKey, driverCapturedAt: capturedAt, position: Promise.resolve(null), custody,
        enqueuePhase: result.current.enqueuePhase, refetchTrip: vi.fn(), onOutcome })
    } else {
      result.current.enqueuePhase('trip', 'phase', 'loading', evidence, null, capturedAt, null, custody, null, phaseKey)
    }
  })
  await act(async () => { void result.current.flush(); await vi.waitFor(() => expect(http.post).toHaveBeenCalledTimes(1)) })
  expect(http.postForm).toHaveBeenCalledWith('/api/v1/artifacts', expect.any(FormData), expect.anything())
  expect(http.post).toHaveBeenCalledWith('/api/v1/trips/trip/phases/phase/complete', expect.objectContaining({
    linehaul_photo_artifact_id: 'artifact-receipt', idempotency_key: phaseKey, custody_sequence: 0,
  }), expect.anything())
  expect(onOutcome).not.toHaveBeenCalled()
  if (path === 'queue') expect(loadQueue()).toEqual([expect.objectContaining({ idempotencyKey: phaseKey, evidence })])

  const receipt = completion === 'recorded' ? duplicate('phase-receipt') : new ApiError(409, 'Handed over', undefined, {
    code: 'TRIP_HANDED_OVER', requestId: null, currentVersion: null, evidenceId: null,
  })
  await act(async () => {
    rejectCompletion(receipt)
    await vi.waitFor(() => {
      if (path === 'live') expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: completion === 'recorded' ? 'recorded' : 'retained' }))
      if (completion === 'refused') expect(loadQueue()).toEqual([expect.objectContaining({
        idempotencyKey: phaseKey, actorId: 'driver-1', custodySequence: 0, evidence,
        status: 'needs-attention', attention: expect.objectContaining({ code: 'TRIP_HANDED_OVER' }),
      })])
      else expect(loadQueue()).toEqual([])
    })
  })
})

it('keeps a queued phase intact when the artifact duplicate has no usable receipt', async () => {
  http.postForm.mockRejectedValue(duplicate(null))
  const { result } = renderHook(() => useOfflineQueue())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); await result.current.flush() })
  await act(async () => {
    result.current.enqueuePhase('trip', 'phase', 'loading', evidence, null, capturedAt, null, custody, null, phaseKey)
    await result.current.flush()
    await vi.waitFor(() => expect(http.postForm).toHaveBeenCalled())
  })
  expect(http.post).not.toHaveBeenCalled()
  expect(loadQueue()).toEqual([expect.objectContaining({ idempotencyKey: phaseKey, evidence })])
})
