import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { useOfflineQueue, __resetOfflineQueueStoreForTests } from '@/lib/hooks/useOfflineQueue'
import { loadQueue } from '@/lib/offline/queue-storage'
import { __setIndexedDbForTests } from '@/lib/offline/exception-store'
import { createFakeIndexedDb } from '@/lib/offline/testing/fake-indexeddb'
import { authenticateTestDriver } from '@/lib/session/testing/custody'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'
import { startPhaseSubmission, __resetPhaseSubmitterForTests, type PhaseSubmissionOutcome } from '../phase-submitter'

const submitPhase = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/phases', () => ({ submitPhase }))

beforeEach(() => {
  vi.clearAllMocks()
  // Mount/account listeners can retry in the background. They see the same offline
  // failure until this test explicitly makes the server's receipt available.
  submitPhase.mockReset().mockRejectedValue(new ApiError(0, 'Still offline'))
  localStorage.clear()
  __setIndexedDbForTests(createFakeIndexedDb())
  __resetOfflineQueueStoreForTests()
  __resetPhaseSubmitterForTests()
  authenticateTestDriver('trip', 1)
})
afterEach(() => { __setIndexedDbForTests(null) })

it.each(['network', 'custody', 'account'] as const)('keeps the original wire key when a submission falls back for %s', async failure => {
  const { result } = renderHook(() => useOfflineQueue())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); await result.current.flush() })
  const key = crypto.randomUUID()
  let release!: () => void
  if (failure === 'account') {
    submitPhase.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ trip: null }) }))
  } else {
    const error = failure === 'network' ? new ApiError(0, 'Response lost') : new ApiError(409, 'Custody changed', undefined, {
      code: 'CUSTODY_CONTEXT_CHANGED', requestId: null, currentVersion: null, evidenceId: null,
    })
    submitPhase.mockRejectedValueOnce(error)
  }
  let finish!: (outcome: PhaseSubmissionOutcome) => void
  const outcome = new Promise<PhaseSubmissionOutcome>(resolve => { finish = resolve })
  act(() => {
    startPhaseSubmission({ tripId: 'trip', phaseEventId: 'phase', phaseType: 'in_transit',
      evidence: { capturedAt: new Date().toISOString() }, idempotencyKey: key,
      driverCapturedAt: new Date().toISOString(), position: Promise.resolve(null),
      enqueuePhase: result.current.enqueuePhase, refetchTrip: vi.fn(), onOutcome: finish })
  })
  if (failure === 'account') {
    await vi.waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
    bindActorLease('other-driver', invalidateActorLease())
    release()
  }
  await act(async () => { await outcome })

  expect(loadQueue()).toEqual([expect.objectContaining({
    idempotencyKey: key, actorId: 'driver-1', custodySequence: 1,
  })])

  if (failure === 'network') {
    submitPhase.mockRejectedValue(new ApiError(409, 'Recorded by this driver and key', undefined, {
      code: 'EVIDENCE_ALREADY_RECORDED', requestId: null, currentVersion: null, evidenceId: 'receipt',
    }))
    await act(async () => {
      await vi.waitFor(async () => { await result.current.flush(); expect(loadQueue()).toEqual([]) })
    })
    expect(submitPhase.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(new Set(submitPhase.mock.calls.map(call => call[4]))).toEqual(new Set([key]))
    expect(loadQueue()).toEqual([])
  }
})

it('does not report queued when the phone refuses to store the retry', async () => {
  // Storage full or disabled: enqueuePhase stores nothing and says so. Reporting "queued" here
  // would keep the optimistic advance and promise a replay that was never scheduled.
  const enqueuePhase = vi.fn(() => false)
  let finish!: (outcome: PhaseSubmissionOutcome) => void
  const outcome = new Promise<PhaseSubmissionOutcome>(resolve => { finish = resolve })
  act(() => {
    startPhaseSubmission({ tripId: 'trip', phaseEventId: 'phase', phaseType: 'in_transit',
      evidence: { capturedAt: new Date().toISOString() }, idempotencyKey: crypto.randomUUID(),
      driverCapturedAt: new Date().toISOString(), position: Promise.resolve(null),
      enqueuePhase, refetchTrip: vi.fn(), onOutcome: finish })
  })

  const result = await outcome

  expect(enqueuePhase).toHaveBeenCalledTimes(1)
  expect(result.kind).toBe('failed')
})
