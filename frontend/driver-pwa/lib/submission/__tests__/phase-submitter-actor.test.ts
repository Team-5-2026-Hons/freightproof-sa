import { beforeEach, expect, it, vi } from 'vitest'
import { startPhaseSubmission, __resetPhaseSubmitterForTests, type PhaseSubmissionRequest, type PhaseSubmissionOutcome } from '../phase-submitter'
import { actorGeneration, bindActorLease, invalidateActorLease, setCustodyContext } from '@/lib/session/custody-context'
import { ApiError } from '@/lib/api/client'
import type { DriverPosition } from '@/lib/types/location'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePhaseSubmissions } from '../phase-submitter'

const submitPhase = vi.fn()
vi.mock('@/lib/api/phases', () => ({ submitPhase: (...args: unknown[]) => submitPhase(...args) }))
const fix = { lat: -30, lng: 25, accuracyM: 8 }

function start(position: Promise<DriverPosition | null>, tripId = 'trip') {
  let settle!: (outcome: PhaseSubmissionOutcome) => void
  const outcome = new Promise<PhaseSubmissionOutcome>(resolve => { settle = resolve })
  const request: PhaseSubmissionRequest = {
    tripId, phaseEventId: crypto.randomUUID(), phaseType: 'loading',
    evidence: { capturedAt: new Date().toISOString() }, idempotencyKey: crypto.randomUUID(),
    driverCapturedAt: new Date().toISOString(), position, enqueuePhase: vi.fn().mockReturnValue(true),
    refetchTrip: vi.fn().mockResolvedValue(null), onOutcome: settle,
  }
  startPhaseSubmission(request)
  return { request, outcome }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetPhaseSubmitterForTests()
  bindActorLease('driver-a', invalidateActorLease())
  submitPhase.mockResolvedValue({ trip: null })
})

it.each([false, true])('stops_after_account_changes_during_phase_gps_return=%s', async returnToA => {
  let deliver!: (value: DriverPosition) => void
  const { request, outcome } = start(new Promise(resolve => { deliver = resolve }))
  bindActorLease('driver-b', invalidateActorLease())
  if (returnToA) bindActorLease('driver-a', invalidateActorLease())
  deliver(fix)
  expect(await outcome).toMatchObject({ kind: 'retained', persisted: true })
  expect(submitPhase).not.toHaveBeenCalled()
  expect(request.enqueuePhase).toHaveBeenCalledWith('trip', request.phaseEventId, 'loading', request.evidence,
    fix, request.driverCapturedAt, null, { actorId: 'driver-a', custodySequence: null }, null, request.idempotencyKey)
})

it('a_new_account_never_uses_the_previous_accounts_cached_fix', async () => {
  await start(Promise.resolve(fix)).outcome
  bindActorLease('driver-b', invalidateActorLease())
  await start(Promise.resolve(null)).outcome
  expect(submitPhase.mock.calls[1][5]).toBeNull()
})

it('retains the original capture instead of publishing a success after an account change during submission', async () => {
  let deliver!: () => void
  submitPhase.mockImplementationOnce(() => new Promise(resolve => { deliver = () => resolve({ trip: null }) }))
  const { outcome } = start(Promise.resolve(fix))
  await vi.waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
  bindActorLease('driver-b', invalidateActorLease())
  deliver()
  expect(await outcome).toMatchObject({ kind: 'retained', persisted: true })
})

it('does not display the old account in-flight phase or its late failure in the new account store', async () => {
  const { result } = renderHook(() => usePhaseSubmissions())
  let deliver!: () => void
  submitPhase.mockImplementationOnce(() => new Promise(resolve => { deliver = () => resolve({ trip: null }) }))
  let pending!: ReturnType<typeof start>
  act(() => { pending = start(Promise.resolve(fix)) })
  await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
  act(() => { bindActorLease('driver-b', invalidateActorLease()) })

  await waitFor(() => expect(result.current.inFlight).toEqual([]))
  await act(async () => { deliver(); await pending.outcome })
  expect(result.current.failures).toEqual([])
})

it.each(['old-first', 'new-first'])('keeps overlapping custody submissions independent when settling %s', async order => {
  const generation = actorGeneration()
  const { result } = renderHook(() => usePhaseSubmissions())
  const pending: Array<{ resolve: (value: { trip: null }) => void; reject: (error: Error) => void }> = []
  submitPhase.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
  const base: PhaseSubmissionRequest = {
    tripId: 'trip', phaseEventId: 'same-phase', phaseType: 'loading',
    evidence: { capturedAt: new Date().toISOString() }, idempotencyKey: 'period-0-key',
    driverCapturedAt: new Date().toISOString(), position: Promise.resolve(fix),
    enqueuePhase: vi.fn().mockReturnValue(true), refetchTrip: vi.fn(), onOutcome: vi.fn(),
  }
  let finishOld!: () => void
  let finishNew!: () => void
  const oldOutcome = new Promise<void>(resolve => { finishOld = resolve })
  const newOutcome = new Promise<void>(resolve => { finishNew = resolve })
  act(() => {
    setCustodyContext({ actorId: 'driver-a', tripId: 'trip', custodySequence: 0 })
    expect(startPhaseSubmission({ ...base, onOutcome: finishOld })).toBe(true)
  })
  await waitFor(() => expect(pending).toHaveLength(1))

  act(() => { setCustodyContext({ actorId: 'driver-a', tripId: 'trip', custodySequence: 2 }) })
  expect(actorGeneration()).toBe(generation)
  await waitFor(() => expect(result.current.inFlight).toEqual([]))
  const current = { ...base, idempotencyKey: 'period-2-key', onOutcome: finishNew }
  act(() => { expect(startPhaseSubmission(current)).toBe(true) })
  await waitFor(() => expect(pending).toHaveLength(2))
  expect(submitPhase.mock.calls.map(call => [call[4], call[8]])).toEqual([
    ['period-0-key', 0], ['period-2-key', 2],
  ])
  expect(result.current.inFlight).toEqual(['same-phase'])

  if (order === 'old-first') {
    await act(async () => { pending[0].reject(new ApiError(422, 'Old period failed')); await oldOutcome })
    expect(result.current.inFlight).toEqual(['same-phase'])
    expect(result.current.failures).toEqual([])
    act(() => { expect(startPhaseSubmission(current)).toBe(false) })
    await act(async () => { pending[1].resolve({ trip: null }); await newOutcome })
    expect(result.current.failures).toEqual([])
  } else {
    await act(async () => { pending[1].reject(new ApiError(422, 'Current period failed')); await newOutcome })
    await act(async () => { pending[0].resolve({ trip: null }); await oldOutcome })
    expect(result.current.failures).toEqual([
      { phaseEventId: 'same-phase', phaseType: 'loading', message: 'Current period failed' },
    ])
  }
  expect(result.current.inFlight).toEqual([])
})

it.each([
  ['pending', 0], ['failed', 0], ['pending', 2], ['failed', 2], ['pending', null], ['failed', null],
] as const)('keeps a %s background attempt in period %s discoverable when selecting another trip and returning', async (status, custodySequence) => {
  const { result } = renderHook(() => usePhaseSubmissions())
  let deliver!: () => void
  let refuse!: () => void
  submitPhase.mockImplementationOnce(() => new Promise((resolve, reject) => {
    deliver = () => resolve({ trip: null })
    refuse = () => reject(new ApiError(422, 'Trip A evidence failed'))
  }))
  let pending!: ReturnType<typeof start>
  act(() => {
    setCustodyContext({ actorId: 'driver-a', tripId: 'trip', custodySequence })
    pending = start(Promise.resolve(fix))
  })
  await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
  await act(async () => {
    setCustodyContext({ actorId: 'driver-a', tripId: 'other-trip', custodySequence: 1 })
    await start(Promise.resolve(fix), 'other-trip').outcome
  })
  expect(result.current.inFlight).toEqual([])
  if (status === 'failed') await act(async () => { refuse(); await pending.outcome })
  expect(result.current.failures).toEqual([])
  act(() => { setCustodyContext({ actorId: 'driver-a', tripId: 'trip', custodySequence }) })
  if (status === 'pending') {
    await waitFor(() => expect(result.current.inFlight).toEqual([pending.request.phaseEventId]))
    act(() => { expect(startPhaseSubmission(pending.request)).toBe(false) })
    await act(async () => { deliver(); await pending.outcome })
  } else {
    await waitFor(() => expect(result.current.failures).toEqual([
      { phaseEventId: pending.request.phaseEventId, phaseType: 'loading', message: 'Trip A evidence failed' },
    ]))
  }
  expect(result.current.inFlight).toEqual([])
})

it('treats a legacy null sequence and period 0 as the same running custody period', async () => {
  const { result } = renderHook(() => usePhaseSubmissions())
  let deliver!: () => void
  submitPhase.mockImplementationOnce(() => new Promise(resolve => { deliver = () => resolve({ trip: null }) }))
  let pending!: ReturnType<typeof start>
  act(() => {
    setCustodyContext({ actorId: 'driver-a', tripId: 'trip', custodySequence: null })
    pending = start(Promise.resolve(fix))
  })
  await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
  act(() => { setCustodyContext({ actorId: 'driver-a', tripId: 'trip', custodySequence: 0 }) })
  expect(result.current.inFlight).toEqual([pending.request.phaseEventId])
  act(() => { expect(startPhaseSubmission(pending.request)).toBe(false) })
  await act(async () => { deliver(); await pending.outcome })
  expect(result.current.inFlight).toEqual([])
})
