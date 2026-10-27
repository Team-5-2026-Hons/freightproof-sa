// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.test.tsx
//
// Core behaviour of the phase-keyed route itself: the type-mismatch guard, mid-phase
// advance (no submit), and — since Workstream 1 — the hand-off model that replaced the
// inline await: the driver lands on Home the instant they swipe, the addressed phase is
// optimistically advanced so Home does not re-offer it, and the submission settles in the
// background (lib/submission/phase-submitter.ts) with its own reconcile / queue / rollback
// paths.
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PhaseStepPageClient from '../PhaseStepPageClient'
import { authenticateTestDriver } from '@/lib/session/testing/custody'
import { setCustodyContext } from '@/lib/session/custody-context'
import { writeDraft } from '@/lib/offline/retained-drafts'
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
const mockEnqueuePhase = vi.fn(() => true)
const mockSubmitPhase = vi.fn()
const mockRefetchTrip = vi.fn()
const mockAdoptTrip = vi.fn()
const mockMarkPhaseSyncing = vi.fn()
const mockClearPhaseSyncing = vi.fn()
const mockNoteTripCompleted = vi.fn()
const mockLocationCapture = vi.fn()
const mockPreviewPhaseLocation = vi.fn()

const FRESH_LOCATION = {
  latitude: -26.09,
  longitude: 28.13,
  accuracy: 8,
  capturedAt: '2026-09-15T10:00:00Z',
}

const PASSING_ASSESSMENT = {
  schema_version: 1 as const,
  policy_version: '2026-09-15.1',
  evaluated_at: '2026-09-15T10:00:01Z',
  driver_lat: -26.09, driver_lng: 28.13, driver_captured_at: FRESH_LOCATION.capturedAt, driver_accuracy_metres: 8,
  tracker_lat: -26.09, tracker_lng: 28.13, tracker_captured_at: '2026-09-15T10:00:01Z',
  separation_metres: 4, proximity: 'within_limit' as const, reasons: [],
  max_separation_metres: 100, max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
  expected_trip_stop_id: 'stop-1', precinct_id: 'precinct-1', precinct_lat: null, precinct_lng: null,
  precinct_radius_metres: null, precinct_tolerance_metres: null, driver_in_precinct: true, truck_in_precinct: true,
}

interface MockTripState {
  trip: Trip
  isLoading: boolean
  refetchTrip: typeof mockRefetchTrip
  adoptTrip: typeof mockAdoptTrip
  syncingPhaseIds: readonly string[]
  markPhaseSyncing: typeof mockMarkPhaseSyncing
  clearPhaseSyncing: typeof mockClearPhaseSyncing
  noteTripCompleted: typeof mockNoteTripCompleted
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
    noteTripCompleted: mockNoteTripCompleted,
  }
}

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace, back: vi.fn() }),
}))
vi.mock('@/lib/hooks/useTrip', () => ({ useTrip: () => tripState }))
const mockCapturePosition = vi.fn(async () => ({ lat: -26.09, lng: 28.13, accuracyM: 8 }))
vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: mockCapturePosition, recordHere: vi.fn() }),
}))
vi.mock('@/lib/hooks/useLocation', () => ({
  useLocation: () => ({ capture: () => mockLocationCapture() }),
}))

vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: mockNotify }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueuePhase: mockEnqueuePhase }),
}))
vi.mock('@/lib/api/phases', () => ({
  submitPhase: (...args: unknown[]) => mockSubmitPhase(...args),
  previewPhaseLocation: (...args: unknown[]) => mockPreviewPhaseLocation(...args),
}))

function AdvanceCaptureSealStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>advance-capture-seal</button>
}

function SubmitVerificationStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-verification</button>
}

function SubmitLoadingStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-loading</button>
}

function AdvanceSealVerifyStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>advance-seal-verify</button>
}

vi.mock('@/components/phase/steps/registry', () => ({
  stepComponentFor: (phaseType: string, slug: string) => {
    if (phaseType === 'departure' && slug === '2-capture-seal') return AdvanceCaptureSealStub
    if (phaseType === 'activation' && slug === '2-verification') return SubmitVerificationStub
    if (phaseType === 'loading' && slug === '1-linehaul') return SubmitLoadingStub
    if (phaseType === 'arrival' && slug === '2-seal-verify') return AdvanceSealVerifyStub
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
    pp_manifest: null,
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
  authenticateTestDriver(TRIP_ID, 2)
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  __resetPhaseSubmitterForTests()
  mockRefetchTrip.mockResolvedValue(null)
  mockLocationCapture.mockResolvedValue(FRESH_LOCATION)
  mockPreviewPhaseLocation.mockResolvedValue(PASSING_ASSESSMENT)
})

afterEach(() => {
  cleanup()
})

describe('type-mismatch guard', () => {
  it('redirects to the ledger-current phase\'s first step when the URL addresses a different phase type', async () => {
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

  it('opens the arrival step while the driverless in_transit row is still the ledger-current phase', () => {
    const trip = makeTrip([
      makePhase({ phase_type: 'departure', sequence_number: 3, status: 'completed' }),
      makePhase({ phase_type: 'in_transit', sequence_number: 4, status: 'pending' }),
      makePhase({ phase_type: 'arrival', sequence_number: 5, status: 'pending' }),
      makePhase({ phase_type: 'unloading', sequence_number: 6, status: 'pending' }),
    ])
    setTripState(trip)
    mockUseParams.mockReturnValue({ type: 'arrival', slug: '2-seal-verify' })

    render(<PhaseStepPageClient />)

    expect(mockRouterReplace).not.toHaveBeenCalled()
    expect(screen.getByText('advance-seal-verify')).toBeInTheDocument()
  })

  it('still redirects a stale URL while in_transit is open, rather than trusting any URL', () => {
    const trip = makeTrip([
      makePhase({ phase_type: 'departure', sequence_number: 3, status: 'completed' }),
      makePhase({ phase_type: 'in_transit', sequence_number: 4, status: 'pending' }),
      makePhase({ phase_type: 'arrival', sequence_number: 5, status: 'pending' }),
      makePhase({ phase_type: 'unloading', sequence_number: 6, status: 'pending' }),
    ])
    setTripState(trip)
    mockUseParams.mockReturnValue({ type: 'activation', slug: '2-verification' })

    render(<PhaseStepPageClient />)

    expect(mockRouterReplace).toHaveBeenCalledWith('/trip/phase/arrival/step/2-seal-verify')
  })

  it('renders normally when the URL phase type matches the ledger\'s current phase', () => {
    setTripState(makeTrip([makePhase({ phase_type: 'departure', sequence_number: 1, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'departure', slug: '2-capture-seal' })

    render(<PhaseStepPageClient />)

    expect(screen.getByText('advance-capture-seal')).toBeInTheDocument()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})

describe('capture scope during location checks', () => {
  it.each(['gps', 'preview'] as const)('does not submit an old-period capture when custody changes during %s', async stage => {
    const loading = makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })
    setTripState(makeTrip([loading]))
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    let complete!: () => void
    if (stage === 'gps') mockLocationCapture.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve(FRESH_LOCATION) }))
    else mockPreviewPhaseLocation.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve(PASSING_ASSESSMENT) }))
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })
    const view = render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))
    await waitFor(() => expect(stage === 'gps' ? mockLocationCapture : mockPreviewPhaseLocation).toHaveBeenCalledTimes(1))

    setCustodyContext({ actorId: 'driver-1', tripId: TRIP_ID, custodySequence: 4 })
    setTripState(makeTrip([loading], { custody_sequence: 4 }))
    view.rerender(<PhaseStepPageClient />)
    await act(async () => { complete(); await Promise.resolve() })

    expect(mockSubmitPhase).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error', title: 'Could not continue', body: 'Account changed; captured work is retained.',
    }))
    fireEvent.click(screen.getByText('submit-loading'))
    await waitFor(() => expect(mockSubmitPhase).toHaveBeenCalledTimes(1))
    expect(mockSubmitPhase.mock.calls[0][8]).toBe(4)
  })
})

describe('mid-phase step — advance only, no submit', () => {
  it('navigates to the next slug in the SAME phase recipe without calling submitPhase', () => {
    setTripState(makeTrip([makePhase({ phase_type: 'departure', sequence_number: 1, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'departure', slug: '2-capture-seal' })

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('advance-capture-seal'))

    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/departure/step/4-departure')
    expect(mockSubmitPhase).not.toHaveBeenCalled()
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

  it('navigates to Home after a passing preview, before the submit has resolved', async () => {
    renderLoadingFinalStep()
    mockSubmitPhase.mockReturnValue(new Promise(() => {}))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/'))
    expect(mockMarkPhaseSyncing).toHaveBeenCalledWith(LOADING_PE)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a non-accusatory notice and requires an explicit continue when a fresh phone fix is unavailable', async () => {
    renderLoadingFinalStep()
    mockSubmitPhase.mockReturnValue(new Promise(() => {}))
    mockLocationCapture.mockResolvedValueOnce(null)

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await screen.findByText('We could not compare your location with the truck. Your action can still be recorded.')
    expect(mockRouterPush).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/'))
  })

  it('submits in the background with the captured position, then reconciles with adoptTrip', async () => {
    const trip = renderLoadingFinalStep()
    const freshTrip = makeTrip([{
      ...trip.phases[0], status: 'completed',
      action_location_assessment: { ...PASSING_ASSESSMENT, proximity: 'separated', separation_metres: 130 },
    }, trip.phases[1]])
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: freshTrip, phaseStatus: 'completed' })

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() => expect(mockSubmitPhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.objectContaining({ capturedAt: null }), expect.any(String),
      { lat: -26.09, lng: 28.13, accuracyM: 8, capturedAt: FRESH_LOCATION.capturedAt },
      FRESH_LOCATION.capturedAt, null, 2,
    ))
    await waitFor(() => expect(mockAdoptTrip).toHaveBeenCalledWith(freshTrip))
    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(LOADING_PE)
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', title: 'Loading recorded' }))
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Location warning recorded' }))
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('clears the draft only once the server confirms, never at hand-off', async () => {
    const trip = renderLoadingFinalStep()
    const draftKey = `fp_draft_${TRIP_ID}_${LOADING_PE}`
    writeDraft(TRIP_ID, LOADING_PE, { actorId: 'driver-1', custodySequence: 2 }, { capturedAt: '2026-01-01T00:00:00Z' })
    let resolveSubmit: (value: unknown) => void = () => {}
    mockSubmitPhase.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve }))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    expect(localStorage.getItem(draftKey)).not.toBeNull()

    resolveSubmit({
      ok: true,
      trip: makeTrip([{ ...trip.phases[0], status: 'completed' }, trip.phases[1]]),
      phaseStatus: 'completed',
    })
    await waitFor(() => expect(localStorage.getItem(draftKey)).toBeNull())
  })

  it('replaces capture and preview on retry, then sends a reasoned reliable-warning acknowledgement', async () => {
    renderLoadingFinalStep()
    const retryCapture = { ...FRESH_LOCATION, latitude: -26.091, capturedAt: '2026-09-15T10:01:00Z' }
    const mismatch = { ...PASSING_ASSESSMENT, proximity: 'separated' as const, separation_metres: 320 }
    mockLocationCapture.mockResolvedValueOnce(FRESH_LOCATION).mockResolvedValueOnce(retryCapture)
    mockPreviewPhaseLocation.mockResolvedValue(mismatch)
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' })

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await screen.findByText('320 m apart')
    expect(mockPreviewPhaseLocation).toHaveBeenLastCalledWith(TRIP_ID, LOADING_PE, {
      lat: FRESH_LOCATION.latitude, lng: FRESH_LOCATION.longitude,
      accuracy_metres: FRESH_LOCATION.accuracy, captured_at: FRESH_LOCATION.capturedAt,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Exception' }))
    expect(screen.getByText('Please provide a reason before continuing.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry Location' }))
    await waitFor(() => expect(mockPreviewPhaseLocation).toHaveBeenLastCalledWith(TRIP_ID, LOADING_PE, {
      lat: retryCapture.latitude, lng: retryCapture.longitude,
      accuracy_metres: retryCapture.accuracy, captured_at: retryCapture.capturedAt,
    }))
    fireEvent.change(screen.getByLabelText('Reason for continuing'), { target: { value: 'Truck is at the gate.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Exception' }))

    await waitFor(() => expect(mockSubmitPhase).toHaveBeenLastCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.anything(), expect.any(String),
      expect.objectContaining({ lat: retryCapture.latitude, capturedAt: retryCapture.capturedAt }),
      retryCapture.capturedAt,
      expect.objectContaining({ reason: 'Truck is at the gate.' }), 2,
    ))
  })
})

describe('the optimistic advance must not redirect this screen into the next phase', () => {
  it('does not fire the mismatch guard when marking the phase syncing moves currentPhase on', async () => {
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
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/'))
    rerender(<PhaseStepPageClient />)

    expect(mockRouterPush).toHaveBeenCalledWith('/')
    expect(mockRouterReplace).not.toHaveBeenCalled()
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
    mockRefetchTrip.mockResolvedValue(makeTrip([{ ...trip.phases[0], status: 'pending' }]))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not confirm phase', body: 'sequence error' }),
      ),
    )
    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(LOADING_PE)
    expect(mockAdoptTrip).not.toHaveBeenCalled()
  })
})

describe('offline-queued submit', () => {
  it('queues the evidence, keeps the draft and the optimistic advance, and leaves the driver on Home', async () => {
    setTripState(makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    const draftKey = `fp_draft_${TRIP_ID}_${LOADING_PE}`
    writeDraft(TRIP_ID, LOADING_PE, { actorId: 'driver-1', custodySequence: 2 }, { capturedAt: '2026-01-01T00:00:00Z' })
    mockSubmitPhase.mockRejectedValue(new TypeError('network down'))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() => expect(mockEnqueuePhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.objectContaining({ capturedAt: '2026-01-01T00:00:00Z' }),
      { lat: -26.09, lng: 28.13, accuracyM: 8, capturedAt: FRESH_LOCATION.capturedAt },
      FRESH_LOCATION.capturedAt, null, { actorId: 'driver-1', custodySequence: 2 }, null, mockSubmitPhase.mock.calls[0][4],
    ))
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', body: expect.stringContaining('Stored on this device') }),
    )
    expect(localStorage.getItem(draftKey)).not.toBeNull()
    expect(mockClearPhaseSyncing).not.toHaveBeenCalled()
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })
})

describe('terminal failure', () => {
  it('rolls the optimistic advance back, raises an error notice, and keeps the draft intact', async () => {
    setTripState(makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })]))
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-linehaul' })
    const draftKey = `fp_draft_${TRIP_ID}_${LOADING_PE}`
    writeDraft(TRIP_ID, LOADING_PE, { actorId: 'driver-1', custodySequence: 2 }, { capturedAt: '2026-01-01T00:00:00Z' })
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
