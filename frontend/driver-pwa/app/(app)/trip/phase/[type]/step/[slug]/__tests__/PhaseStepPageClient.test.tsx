// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.test.tsx
//
// Core behaviour of the phase-keyed route itself: the type-mismatch guard, mid-phase
// advance (no submit), and — since Workstream 1 — the hand-off model that replaced the
// inline await: the driver lands on Home the instant they swipe, the addressed phase is
// optimistically advanced so Home does not re-offer it, and the submission settles in the
// background (lib/submission/phase-submitter.ts) with its own reconcile / queue / rollback
// paths.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PhaseStepPageClient from '../PhaseStepPageClient'
import { ApiError } from '@/lib/api/client'
import { __resetPhaseSubmitterForTests } from '@/lib/submission/phase-submitter'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'

const TRIP_ID = 'trip-1'
const ACTIVATION_PE = 'pe-activation-1' as PhaseEventId
const LOADING_PE = 'pe-loading-1' as PhaseEventId

const mockUseParams = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()
const mockNotify = vi.fn()
const mockEnqueuePhase = vi.fn()
const mockSubmitPhase = vi.fn()
const mockRefetchTrip = vi.fn()
// The success path adopts the trip the submit already returned instead of refetching it.
const mockAdoptTrip = vi.fn()
// Workstream 1's optimistic advance, owned by TripContext.
const mockMarkPhaseSyncing = vi.fn()
const mockClearPhaseSyncing = vi.fn()

interface MockTripState {
  trip: Trip
  isLoading: boolean
  refetchTrip: typeof mockRefetchTrip
  adoptTrip: typeof mockAdoptTrip
  syncingPhaseIds: readonly string[]
  markPhaseSyncing: typeof mockMarkPhaseSyncing
  clearPhaseSyncing: typeof mockClearPhaseSyncing
}

let tripState: MockTripState

function setTripState(trip: Trip): void {
  tripState = {
    trip,
    isLoading: false,
    refetchTrip: mockRefetchTrip,
    adoptTrip: mockAdoptTrip,
    syncingPhaseIds: [],
    markPhaseSyncing: mockMarkPhaseSyncing,
    clearPhaseSyncing: mockClearPhaseSyncing,
  }
}

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace, back: vi.fn() }),
}))
vi.mock('@/lib/hooks/useTrip', () => ({ useTrip: () => tripState }))
// The step pages take a GPS fix silently at submit time (lib/context/LocationContext.tsx).
// Mocked like every other hook here so these tests stay about submission behaviour, and
// so the fix is a known value the payload assertions can check for.
const mockCapturePosition = vi.fn(async () => ({ lat: -26.09, lng: 28.13, accuracyM: 8 }))
vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: mockCapturePosition, recordHere: vi.fn() }),
}))

vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: mockNotify }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueuePhase: mockEnqueuePhase }),
}))
vi.mock('@/lib/api/phases', () => ({ submitPhase: (...args: unknown[]) => mockSubmitPhase(...args) }))

// departure's recipe is ['2-capture-seal', '3-waybill', '4-departure'], so its first
// step is the mid-phase "advance, don't submit" case. It used to be activation's
// '1-approach-gate', which no longer exists — activation is a single step now that its
// GPS capture happens silently at submit.
function AdvanceCaptureSealStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>advance-capture-seal</button>
}

function SubmitVerificationStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-verification</button>
}

function SubmitLoadingStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-loading</button>
}

vi.mock('@/components/phase/steps/registry', () => ({
  stepComponentFor: (phaseType: string, slug: string) => {
    if (phaseType === 'departure' && slug === '2-capture-seal') return AdvanceCaptureSealStub
    if (phaseType === 'activation' && slug === '2-verification') return SubmitVerificationStub
    if (phaseType === 'loading' && slug === '1-linehaul') return SubmitLoadingStub
    return undefined
  },
}))

function makePhase(overrides: Partial<PhaseDescriptor>): PhaseDescriptor {
  return {
    phase_event_id: ACTIVATION_PE,
    trip_id: TRIP_ID,
    phase_type: 'activation',
    trip_stop_id: null,
    stop_sequence: null,
    sequence_number: 1,
    status: 'in_progress',
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
    ...overrides,
  }
}

function makeTrip(phases: PhaseDescriptor[], overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID as unknown as Trip['id'],
    trip_reference: 'TRP-TEST-0001',
    order_number: 'ORD-1',
    status: 'active',
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
    phases,
    current_phase: phases[0]?.phase_type ?? null,
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // The submitter's in-flight registry, failure list and last-known-fix cache all live at
  // module scope (that is the point of it) — vitest's per-test isolation cannot reach them.
  __resetPhaseSubmitterForTests()
  mockRefetchTrip.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
})

describe('type-mismatch guard', () => {
  it('redirects to the ledger-current phase\'s first step when the URL addresses a different phase type', async () => {
    // The ledger's current phase is `loading`, but the URL still says `activation`
    // (e.g. a stale back-navigation after activation already completed).
    const trip = makeTrip([
      makePhase({ phase_type: 'activation', sequence_number: 1, status: 'completed' }),
      makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' }),
    ])
    setTripState(trip)
    mockUseParams.mockReturnValue({ type: 'activation', slug: '2-verification' })

    render(<PhaseStepPageClient />)

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/trip/phase/loading/step/1-linehaul'))
    expect(screen.queryByText('submit-verification')).not.toBeInTheDocument()
  })

  it('renders normally when the URL phase type matches the ledger\'s current phase', () => {
    setTripState(makeTrip([makePhase({ phase_type: 'departure', sequence_number: 1, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'departure', slug: '2-capture-seal' })

    render(<PhaseStepPageClient />)

    expect(screen.getByText('advance-capture-seal')).toBeInTheDocument()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})

describe('mid-phase step — advance only, no submit', () => {
  it('navigates to the next slug in the SAME phase recipe without calling submitPhase', () => {
    setTripState(makeTrip([makePhase({ phase_type: 'departure', sequence_number: 1, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'departure', slug: '2-capture-seal' })

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('advance-capture-seal'))

    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/departure/step/3-waybill')
    expect(mockSubmitPhase).not.toHaveBeenCalled()
    // Mid-phase steps capture nothing and submit nothing, so there is nothing to advance
    // optimistically either.
    expect(mockMarkPhaseSyncing).not.toHaveBeenCalled()
  })
})

describe('final step — hands the submission off and returns the driver Home', () => {
  function renderLoadingFinalStep(): Trip {
    const trip = makeTrip([
      makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' }),
      makePhase({ phase_type: 'departure', sequence_number: 3, status: 'pending' }),
    ])
    setTripState(trip)
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    return trip
  }

  it('navigates to Home in the same tick as the swipe, before the submit has resolved', () => {
    renderLoadingFinalStep()
    // A submit that never settles: if the navigation depended on it at all, this test
    // could not pass. This is the whole complaint Workstream 1 exists to fix.
    mockSubmitPhase.mockReturnValue(new Promise(() => {}))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    expect(mockRouterPush).toHaveBeenCalledWith('/')
    // ...and the phase is optimistically advanced first, so Home's first render does not
    // re-offer the step the driver just finished.
    expect(mockMarkPhaseSyncing).toHaveBeenCalledWith(LOADING_PE)
  })

  it('does not wait on the GPS fix either — a cold phone cannot delay the transition', () => {
    renderLoadingFinalStep()
    mockSubmitPhase.mockReturnValue(new Promise(() => {}))
    mockCapturePosition.mockReturnValueOnce(new Promise(() => {}))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('submits in the background with the captured position, then reconciles with adoptTrip', async () => {
    const trip = renderLoadingFinalStep()
    const freshTrip = makeTrip([{ ...trip.phases[0], status: 'completed' }, trip.phases[1]])
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: freshTrip, phaseStatus: 'completed' })

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() => expect(mockSubmitPhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.anything(), expect.any(String),
      { lat: -26.09, lng: 28.13, accuracyM: 8 },
    ))
    // The server's own plan replaces the optimistic guess, and the marker is dropped.
    await waitFor(() => expect(mockAdoptTrip).toHaveBeenCalledWith(freshTrip))
    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(LOADING_PE)
    // The toast fires from wherever the driver has navigated to, not from the step screen.
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', title: 'Loading recorded' }))
    // No second navigation: the driver was sent Home at swipe time and stays there.
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('clears the draft only once the server confirms, never at hand-off', async () => {
    const trip = renderLoadingFinalStep()
    const draftKey = `fp_draft_${TRIP_ID}_${LOADING_PE}`
    localStorage.setItem(draftKey, JSON.stringify({ capturedAt: '2026-01-01T00:00:00Z' }))
    let resolveSubmit: (value: unknown) => void = () => {}
    mockSubmitPhase.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve }))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    // Handed off and navigated, but the evidence is still on the device — losing it here
    // would leave a driver with nothing to re-submit if the request then failed.
    expect(localStorage.getItem(draftKey)).not.toBeNull()

    resolveSubmit({
      ok: true,
      trip: makeTrip([{ ...trip.phases[0], status: 'completed' }, trip.phases[1]]),
      phaseStatus: 'completed',
    })
    await waitFor(() => expect(localStorage.getItem(draftKey)).toBeNull())
  })
})

describe('the optimistic advance must not redirect this screen into the next phase', () => {
  it('does not fire the mismatch guard when marking the phase syncing moves currentPhase on', async () => {
    // markPhaseSyncing really does resolve the phase in TripContext, which is exactly the
    // regression: the screen would see currentPhase() move to `departure`, decide its own
    // URL was stale, and router.replace() the driver into departure's first step — racing
    // the push to Home that had already been issued.
    const loading = makePhase({
      phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress',
    })
    const departure = makePhase({ phase_type: 'departure', sequence_number: 3, status: 'pending' })
    setTripState(makeTrip([loading, departure]))
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    mockSubmitPhase.mockReturnValue(new Promise(() => {}))
    mockMarkPhaseSyncing.mockImplementation(() => {
      setTripState(makeTrip([{ ...loading, status: 'completed' }, departure]))
    })

    const { rerender } = render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))
    rerender(<PhaseStepPageClient />)

    expect(mockRouterPush).toHaveBeenCalledWith('/')
    expect(mockRouterReplace).not.toHaveBeenCalled()
    // Still the step the driver just confirmed, frozen while the route change commits.
    expect(screen.getByText('submit-loading')).toBeInTheDocument()
  })
})

describe('409 duplicate-submit detection via the addressed phase\'s own status', () => {
  it('a 409 whose addressed phase already reads "completed" is treated as an earlier success, not a failure', async () => {
    const trip = makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })])
    setTripState(trip)
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'already resolved'))
    const fetchedAfterConflict = makeTrip([{ ...trip.phases[0], status: 'completed' }])
    mockRefetchTrip.mockResolvedValue(fetchedAfterConflict)

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', title: 'Loading recorded' })),
    )
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    expect(mockAdoptTrip).toHaveBeenCalledWith(fetchedAfterConflict)
  })

  it('a 409 whose addressed phase is still pending is a genuine conflict — the optimistic advance is rolled back', async () => {
    const trip = makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })])
    setTripState(trip)
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'sequence error'))
    // Still pending on refetch — this really is a genuine conflict, not a replay.
    mockRefetchTrip.mockResolvedValue(makeTrip([{ ...trip.phases[0], status: 'pending' }]))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not confirm phase', body: 'sequence error' }),
      ),
    )
    // Rolled back, so Home re-offers the step and the driver can retry with their draft.
    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(LOADING_PE)
    expect(mockAdoptTrip).not.toHaveBeenCalled()
  })
})

describe('offline-queued submit', () => {
  it('queues the evidence, keeps the draft and the optimistic advance, and leaves the driver on Home', async () => {
    setTripState(makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    const draftKey = `fp_draft_${TRIP_ID}_${LOADING_PE}`
    localStorage.setItem(draftKey, JSON.stringify({ capturedAt: '2026-01-01T00:00:00Z' }))
    mockSubmitPhase.mockRejectedValue(new TypeError('network down'))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    // The position is queued WITH the entry, so a replay hours later still reports where
    // the driver was when they swiped rather than where they regained signal.
    await waitFor(() => expect(mockEnqueuePhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.anything(),
      { lat: -26.09, lng: 28.13, accuracyM: 8 },
    ))
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', body: expect.stringContaining('stored on this device') }),
    )
    // Not cleared and not rolled back: the queue holds the evidence and will replay it,
    // so re-offering the step would only invite a second copy of the same submission.
    expect(localStorage.getItem(draftKey)).not.toBeNull()
    expect(mockClearPhaseSyncing).not.toHaveBeenCalled()
    // Home, at swipe time — no second navigation to the trip hub afterwards.
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })
})

describe('terminal failure', () => {
  it('rolls the optimistic advance back, raises an error notice, and keeps the draft intact', async () => {
    setTripState(makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    const draftKey = `fp_draft_${TRIP_ID}_${LOADING_PE}`
    localStorage.setItem(draftKey, JSON.stringify({ capturedAt: '2026-01-01T00:00:00Z' }))
    mockSubmitPhase.mockRejectedValue(new ApiError(422, 'visual count is required'))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not submit', body: 'visual count is required' }),
      ),
    )
    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(LOADING_PE)
    expect(mockEnqueuePhase).not.toHaveBeenCalled()
    expect(localStorage.getItem(draftKey)).not.toBeNull()
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  })
})

describe('exception_hold', () => {
  it('still toasts and routes to the trip screen, from wherever the driver has landed', async () => {
    const trip = makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })])
    setTripState(trip)
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    const heldTrip = makeTrip([{ ...trip.phases[0], status: 'exception' }], { status: 'exception_hold' })
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: heldTrip, phaseStatus: 'exception' })

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', title: 'Trip on hold' })),
    )
    expect(mockRouterPush).toHaveBeenNthCalledWith(1, '/')
    expect(mockRouterPush).toHaveBeenNthCalledWith(2, '/trips/active')
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  })
})
