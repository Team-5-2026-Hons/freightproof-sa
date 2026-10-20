import { beforeEach, expect, it, vi } from 'vitest'
import { startPhaseSubmission, __resetPhaseSubmitterForTests, type PhaseSubmissionRequest, type PhaseSubmissionOutcome } from '../phase-submitter'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'
import type { DriverPosition } from '@/lib/types/location'

const submitPhase = vi.fn()
vi.mock('@/lib/api/phases', () => ({ submitPhase: (...args: unknown[]) => submitPhase(...args) }))
const fix = { lat: -30, lng: 25, accuracyM: 8 }

function start(position: Promise<DriverPosition | null>) {
  let settle!: (outcome: PhaseSubmissionOutcome) => void
  const outcome = new Promise<PhaseSubmissionOutcome>(resolve => { settle = resolve })
  const request: PhaseSubmissionRequest = {
    tripId: 'trip', phaseEventId: crypto.randomUUID(), phaseType: 'loading',
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
    fix, request.driverCapturedAt, null, { actorId: 'driver-a', custodySequence: null })
})

it('a_new_account_never_uses_the_previous_accounts_cached_fix', async () => {
  await start(Promise.resolve(fix)).outcome
  bindActorLease('driver-b', invalidateActorLease())
  await start(Promise.resolve(null)).outcome
  expect(submitPhase.mock.calls[1][5]).toBeNull()
})
