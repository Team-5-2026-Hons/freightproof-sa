// frontend/driver-pwa/lib/submission/__tests__/phase-submitter.test.ts
//
// The background submitter in isolation — no React, no router, no step page. Everything
// the step page used to do inline after `await submitPhase(...)` now depends on these
// outcomes being classified correctly, and getting one wrong means either a driver told
// their evidence landed when it didn't, or a duplicate ledger write.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  startPhaseSubmission,
  dismissPhaseSubmissionFailure,
  __resetPhaseSubmitterForTests,
  type PhaseSubmissionOutcome,
  type PhaseSubmissionRequest,
} from '../phase-submitter'
import { ApiError } from '@/lib/api/client'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseEventId, PhaseStatus } from '@shared/lib/types/phase'
import type { DriverPosition } from '@/lib/types/location'

const TRIP_ID = 'trip-1'
const LOADING_PE = 'pe-loading-1' as PhaseEventId
const FIX: DriverPosition = { lat: -26.09, lng: 28.13, accuracyM: 8 }

const mockSubmitPhase = vi.fn()
vi.mock('@/lib/api/phases', () => ({ submitPhase: (...args: unknown[]) => mockSubmitPhase(...args) }))

// The store's own rendering (in-flight line, failure notices) is covered where it is
// actually consumed — components/layout/__tests__/OfflineBanner.test.tsx — rather than by
// reaching into module internals from here.

function makePhase(status: PhaseStatus): PhaseDescriptor {
  return {
    phase_event_id: LOADING_PE,
    trip_id: TRIP_ID,
    phase_type: 'loading',
    trip_stop_id: null,
    stop_sequence: null,
    sequence_number: 2,
    status,
    anchor_status: 'not_required',
    step_recipe: [],
    dispatcher_override_user_id: null,
    dispatcher_override_note: null,
    driver_phone_lat: null,
    driver_phone_lng: null,
    horse_gps_lat: null,
    horse_gps_lng: null,
    pulsit_geofence_confirmed: null,
    seal_number: null,
    seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null,
    gate_photo_artifact_id: null,
    pod_photo_artifact_id: null,
    pod_signature_artifact_id: null,
    parcel_count_origin: null,
    parcel_count_destination: null,
    driver_visual_count: null,
    event_hash: null,
    blockchain_receipt_id: null,
    idempotency_key: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeTrip(phase: PhaseDescriptor, status: Trip['status'] = 'active'): Trip {
  return {
    id: TRIP_ID as unknown as Trip['id'],
    trip_reference: 'TRP-TEST-0001',
    order_number: 'ORD-1',
    status,
    trip_type: 'loaded',
    journey_lock_hash: null,
    idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-1',
    destination_precinct_id: 'precinct-2',
    stops: [],
    consignments: [],
    pulsit_trip_reference_id: null,
    planned_departure_at: null,
    actual_departure_at: null,
    planned_arrival_at: null,
    actual_arrival_at: null,
    closed_at: null,
    driver: null,
    horse: null,
    trailers: [],
    phases: [phase],
    current_phase: phase.phase_type,
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

interface Harness {
  request: PhaseSubmissionRequest
  enqueuePhase: ReturnType<typeof vi.fn>
  refetchTrip: ReturnType<typeof vi.fn>
  outcome: Promise<PhaseSubmissionOutcome>
}

function harness(overrides: Partial<PhaseSubmissionRequest> = {}): Harness {
  const enqueuePhase = vi.fn()
  const refetchTrip = vi.fn().mockResolvedValue(null)
  let settle: (outcome: PhaseSubmissionOutcome) => void = () => {}
  const outcome = new Promise<PhaseSubmissionOutcome>((resolve) => { settle = resolve })

  const request: PhaseSubmissionRequest = {
    tripId: TRIP_ID,
    phaseEventId: LOADING_PE,
    phaseType: 'loading',
    evidence: { driverVisualCount: 12, capturedAt: '2026-01-01T00:00:00Z' },
    idempotencyKey: 'idem-1',
    position: Promise.resolve<DriverPosition | null>(FIX),
    enqueuePhase,
    refetchTrip,
    onOutcome: (result) => settle(result),
    ...overrides,
  }

  return { request, enqueuePhase, refetchTrip, outcome }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetPhaseSubmitterForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startPhaseSubmission — success paths', () => {
  it('sends the captured position with the evidence and reports the addressed phase back', async () => {
    const completed = makePhase('completed')
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: makeTrip(completed), phaseStatus: 'completed' })
    const h = harness()

    expect(startPhaseSubmission(h.request)).toBe(true)
    const outcome = await h.outcome

    expect(mockSubmitPhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', h.request.evidence, 'idem-1', FIX,
    )
    expect(outcome.kind).toBe('recorded')
    if (outcome.kind !== 'recorded') throw new Error('unreachable')
    expect(outcome.addressedPhase?.status).toBe('completed')
  })

  it('reports a hold when the submit response puts the trip on exception_hold', async () => {
    const held = makeTrip(makePhase('exception'), 'exception_hold')
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: held, phaseStatus: 'exception' })
    const h = harness()

    startPhaseSubmission(h.request)

    expect((await h.outcome).kind).toBe('hold')
  })

  it('demo mode (a null trip in the response) still reports recorded, with no addressed phase', async () => {
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    const h = harness()

    startPhaseSubmission(h.request)
    const outcome = await h.outcome

    expect(outcome).toEqual({ kind: 'recorded', trip: null, addressedPhase: null })
  })
})

describe('startPhaseSubmission — 409 reconciliation', () => {
  it('treats a 409 whose addressed phase is already resolved as an earlier success', async () => {
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'already resolved'))
    const fetched = makeTrip(makePhase('completed'))
    const h = harness()
    h.refetchTrip.mockResolvedValue(fetched)

    startPhaseSubmission(h.request)
    const outcome = await h.outcome

    expect(outcome.kind).toBe('recorded')
    if (outcome.kind !== 'recorded') throw new Error('unreachable')
    expect(outcome.trip).toBe(fetched)
  })

  it('treats a 409 whose addressed phase is still pending as a genuine conflict, carrying the server detail', async () => {
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'origin gate is not complete'))
    const h = harness()
    h.refetchTrip.mockResolvedValue(makeTrip(makePhase('pending')))

    startPhaseSubmission(h.request)

    expect(await h.outcome).toEqual({ kind: 'conflict', message: 'origin gate is not complete' })
  })

  it('reports a conflict rather than guessing when the 409 refetch itself fails', async () => {
    // Guessing "already recorded" here would tell a driver their evidence landed when we
    // have no idea whether it did.
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'conflict'))
    const h = harness()
    h.refetchTrip.mockRejectedValue(new TypeError('network down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    startPhaseSubmission(h.request)

    expect((await h.outcome).kind).toBe('conflict')
    expect(consoleError).toHaveBeenCalled()
  })

  it('reports a hold when the 409 refetch reveals the trip is held', async () => {
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'trip held'))
    const h = harness()
    h.refetchTrip.mockResolvedValue(makeTrip(makePhase('exception'), 'exception_hold'))

    startPhaseSubmission(h.request)

    expect((await h.outcome).kind).toBe('hold')
  })
})

describe('startPhaseSubmission — failure paths', () => {
  it('falls back to the localStorage queue on a network failure, position included', async () => {
    mockSubmitPhase.mockRejectedValue(new TypeError('network down'))
    const h = harness()

    startPhaseSubmission(h.request)

    expect((await h.outcome).kind).toBe('queued')
    expect(h.enqueuePhase).toHaveBeenCalledWith(TRIP_ID, LOADING_PE, 'loading', h.request.evidence, FIX)
  })

  it('queues a 5xx too — the server may recover', async () => {
    mockSubmitPhase.mockRejectedValue(new ApiError(503, 'unavailable'))
    const h = harness()

    startPhaseSubmission(h.request)

    expect((await h.outcome).kind).toBe('queued')
    expect(h.enqueuePhase).toHaveBeenCalled()
  })

  it('never queues a terminal 4xx — retrying it can only fail the same way forever', async () => {
    mockSubmitPhase.mockRejectedValue(new ApiError(422, 'visual count is required'))
    const h = harness()

    startPhaseSubmission(h.request)

    expect(await h.outcome).toEqual({ kind: 'failed', message: 'visual count is required' })
    expect(h.enqueuePhase).not.toHaveBeenCalled()
  })

  it('never queues a local validation throw either — nothing reached the network', async () => {
    mockSubmitPhase.mockRejectedValue(new Error('Activation evidence incomplete'))
    const h = harness()

    startPhaseSubmission(h.request)

    expect(await h.outcome).toEqual({ kind: 'failed', message: 'Activation evidence incomplete' })
    expect(h.enqueuePhase).not.toHaveBeenCalled()
  })
})

describe('startPhaseSubmission — duplicate protection', () => {
  it('refuses a second submission for the same phase_event_id while one is running', async () => {
    let resolveSubmit: (value: unknown) => void = () => {}
    mockSubmitPhase.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve }))
    const first = harness()
    const second = harness()

    expect(startPhaseSubmission(first.request)).toBe(true)
    expect(startPhaseSubmission(second.request)).toBe(false)

    resolveSubmit({ ok: true, trip: null, phaseStatus: 'completed' })
    await first.outcome
    expect(mockSubmitPhase).toHaveBeenCalledTimes(1)
  })

  it('allows a fresh attempt once the previous one has settled', async () => {
    mockSubmitPhase.mockRejectedValue(new ApiError(422, 'invalid'))
    const first = harness()

    startPhaseSubmission(first.request)
    await first.outcome

    const second = harness()
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    expect(startPhaseSubmission(second.request)).toBe(true)
    expect((await second.outcome).kind).toBe('recorded')
  })
})

describe('position budget', () => {
  it('submits without a position when the capture yields nothing and no recent fix is held', async () => {
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    const h = harness({ position: Promise.resolve(null) })

    startPhaseSubmission(h.request)
    await h.outcome

    expect(mockSubmitPhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.anything(), 'idem-1', null,
    )
  })

  it('falls back to the fix a previous submission just took rather than sending none', async () => {
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    const first = harness()
    startPhaseSubmission(first.request)
    await first.outcome

    // Second phase, seconds later, GPS now unavailable (the driver stepped inside).
    const second = harness({ phaseEventId: 'pe-departure-1', position: Promise.resolve(null) })
    startPhaseSubmission(second.request)
    await second.outcome

    expect(mockSubmitPhase).toHaveBeenLastCalledWith(
      TRIP_ID, 'pe-departure-1', 'loading', expect.anything(), 'idem-1', FIX,
    )
  })

  it('does not wait forever on a hung capture — the submission goes out once the budget expires', async () => {
    vi.useFakeTimers()
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    const h = harness({ position: new Promise<DriverPosition | null>(() => {}) })

    startPhaseSubmission(h.request)
    expect(mockSubmitPhase).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(12_000)

    expect(mockSubmitPhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.anything(), 'idem-1', null,
    )
  })

  it('survives a rejected capture instead of losing the submission to an unhandled rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    const h = harness({ position: Promise.reject(new Error('geolocation exploded')) })

    startPhaseSubmission(h.request)

    expect((await h.outcome).kind).toBe('recorded')
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('failure notices', () => {
  it('are dismissible per phase', async () => {
    mockSubmitPhase.mockRejectedValue(new ApiError(422, 'invalid'))
    const h = harness()

    startPhaseSubmission(h.request)
    await h.outcome

    // No throw, and idempotent — the banner calls this from a click handler that may fire
    // after the notice has already gone.
    dismissPhaseSubmissionFailure(LOADING_PE)
    dismissPhaseSubmissionFailure(LOADING_PE)
  })
})
