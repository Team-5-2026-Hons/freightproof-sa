// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.test.tsx
//
// Core behaviour of the new phase-keyed route itself (task 1/2 of the phase-step
// integration): the type-mismatch guard, mid-phase advance (no submit), and 409
// duplicate-submit detection via the addressed phase's own status (replacing the old
// STATUS_ORDER/isAtOrPast ordinal comparison, which has no equivalent left now that
// TripStatus is a coarse five).
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PhaseStepPageClient from '../PhaseStepPageClient'
import { ApiError } from '@/lib/api/client'
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

interface MockTripState {
  trip: Trip
  isLoading: boolean
  refetchTrip: typeof mockRefetchTrip
}

let tripState: MockTripState

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
    if (phaseType === 'loading' && slug === '1-visual-count') return SubmitLoadingStub
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
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'activation', slug: '2-verification' })

    render(<PhaseStepPageClient />)

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/trip/phase/loading/step/1-visual-count'))
    expect(screen.queryByText('submit-verification')).not.toBeInTheDocument()
  })

  it('renders normally when the URL phase type matches the ledger\'s current phase', () => {
    const trip = makeTrip([makePhase({ phase_type: 'departure', sequence_number: 1, status: 'in_progress' })])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'departure', slug: '2-capture-seal' })

    render(<PhaseStepPageClient />)

    expect(screen.getByText('advance-capture-seal')).toBeInTheDocument()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})

describe('mid-phase step — advance only, no submit', () => {
  it('navigates to the next slug in the SAME phase recipe without calling submitPhase', () => {
    const trip = makeTrip([makePhase({ phase_type: 'departure', sequence_number: 1, status: 'in_progress' })])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'departure', slug: '2-capture-seal' })

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('advance-capture-seal'))

    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/departure/step/3-waybill')
    expect(mockSubmitPhase).not.toHaveBeenCalled()
  })
})

describe('final step — submits on the phase recipe\'s last slug', () => {
  it('loading has one step total, so it submits immediately and advances to the next phase', async () => {
    const trip = makeTrip([
      makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' }),
      makePhase({ phase_type: 'departure', sequence_number: 3, status: 'pending' }),
    ])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-visual-count' })
    const freshTrip = makeTrip([
      { ...trip.phases[0], status: 'completed' },
      trip.phases[1],
    ])
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: freshTrip, phaseStatus: 'completed' })
    mockRefetchTrip.mockResolvedValue(freshTrip)

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() => expect(mockSubmitPhase).toHaveBeenCalledWith(
      TRIP_ID, LOADING_PE, 'loading', expect.anything(), expect.any(String),
      { lat: -26.09, lng: 28.13, accuracyM: 8 },
    ))
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/departure/step/2-capture-seal'))
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', title: 'Loading recorded' }))
  })
})

describe('409 duplicate-submit detection via the addressed phase\'s own status', () => {
  it('a 409 whose addressed phase already reads "completed" is treated as an earlier success, not a failure', async () => {
    const trip = makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-visual-count' })
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'already resolved'))
    const fetchedAfterConflict = makeTrip([{ ...trip.phases[0], status: 'completed' }])
    mockRefetchTrip.mockResolvedValue(fetchedAfterConflict)

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', title: 'Loading recorded' })),
    )
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  })

  it('a 409 whose addressed phase is still pending is a genuine conflict — error toast, no navigation', async () => {
    const trip = makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-visual-count' })
    mockSubmitPhase.mockRejectedValue(new ApiError(409, 'sequence error'))
    // Still pending on refetch — this really is a genuine conflict, not a replay.
    mockRefetchTrip.mockResolvedValue(makeTrip([{ ...trip.phases[0], status: 'pending' }]))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-loading'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', title: 'Could not confirm phase' })),
    )
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

describe('offline-queued submit', () => {
  it('queues the evidence and routes to the trip hub, not the next phase\'s URL', async () => {
    const trip = makeTrip([makePhase({ phase_event_id: LOADING_PE, phase_type: 'loading', sequence_number: 2, status: 'in_progress' })])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'loading', slug: '1-visual-count' })
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
    expect(mockRouterPush).toHaveBeenCalledWith('/trips/active')
  })
})
