// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.anchoring.test.tsx
//
// Carried over from the deleted
// HandshakeStepPageClient.anchoring.test.tsx — that suite hard-coded loading/unloading
// as the anchored handshakes, which is now WRONG under the phase model. ANCHORED_PHASES
// (shared/lib/constants/phase-meta.ts) is trip_creation, departure, confirmation — this
// suite exercises departure and confirmation (trip_creation has no driver-facing step at
// all). The completion receipt must only claim a Hedera anchor for a REAL (non-demo),
// non-queued submission of one of those. This is a dedicated real-mode file (mirrors
// lib/context/__tests__/AuthContext.real.test.tsx) because IS_DEMO_MODE is read at
// module import time, so real vs. demo mode needs separate test files.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PhaseStepPageClient from '../PhaseStepPageClient'
import { ApiError } from '@/lib/api/client'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const TRIP_ID = 'trip-1'
const DEPARTURE_PE = 'pe-departure-1' as PhaseEventId
const CONFIRMATION_PE = 'pe-confirmation-1' as PhaseEventId

const mockUseParams = vi.fn()
const mockRouterPush = vi.fn()
const mockNotify = vi.fn()
const mockEnqueuePhase = vi.fn()
const mockSubmitPhase = vi.fn()
const mockRefetchTrip = vi.fn()

interface MockTripState {
  trip: Trip
  isLoading: boolean
  refetchTrip: typeof mockRefetchTrip
}

// Mutable module-level value, reassigned per test — the current PHASE must match
// whatever mockUseParams' [type] is set to for that test (the guard redirects
// otherwise), and departure/confirmation need different phase_event_id fixtures.
let tripState: MockTripState

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), back: vi.fn() }),
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

function SubmitDepartureStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-departure</button>
}

function SubmitConfirmationStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-confirmation</button>
}

vi.mock('@/components/phase/steps/registry', () => ({
  stepComponentFor: (phaseType: string, slug: string) => {
    if (phaseType === 'departure' && slug === '4-departure') return SubmitDepartureStub
    if (phaseType === 'confirmation' && slug === '4-closed') return SubmitConfirmationStub
    return undefined
  },
}))

function makePhase(overrides: Partial<PhaseDescriptor>): PhaseDescriptor {
  return {
    phase_event_id: DEPARTURE_PE,
    trip_id: TRIP_ID,
    phase_type: 'departure',
    trip_stop_id: null,
    stop_sequence: null,
    sequence_number: 3,
    status: 'in_progress',
    anchor_status: 'pending',
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
})

afterEach(() => {
  cleanup()
})

describe('PhaseStepPageClient anchoring receipt copy — real mode', () => {
  it('a real departure success with the Hedera receipt back claims the anchor', async () => {
    const departure = makePhase({ phase_type: 'departure', sequence_number: 3, status: 'in_progress' })
    tripState = { trip: makeTrip([departure]), isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'departure', slug: '4-departure' })
    const freshTrip = makeTrip([{ ...departure, status: 'completed', blockchain_receipt_id: 'receipt-1' }])
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: freshTrip, phaseStatus: 'completed' })
    mockRefetchTrip.mockResolvedValue(freshTrip)

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-departure'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'success',
          title: 'Departure recorded',
          body: expect.stringContaining('anchored to Hedera HCS'),
        }),
      ),
    )
  })

  it('a real confirmation success with the receipt back also claims the anchor', async () => {
    const confirmation = makePhase({
      phase_event_id: CONFIRMATION_PE, phase_type: 'confirmation', sequence_number: 6, status: 'in_progress',
    })
    tripState = { trip: makeTrip([confirmation]), isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'confirmation', slug: '4-closed' })
    const freshTrip = makeTrip(
      [{ ...confirmation, status: 'completed', blockchain_receipt_id: 'receipt-2' }],
      { status: 'closed' },
    )
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: freshTrip, phaseStatus: 'completed' })
    mockRefetchTrip.mockResolvedValue(null) // trip is closed — /trips/me/active has nothing left

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-confirmation'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'success',
          title: 'Confirmation recorded',
          body: expect.stringContaining('anchored to Hedera HCS'),
        }),
      ),
    )
  })

  it('a real departure success whose receipt has not come back yet says anchoring is in progress, not anchored', async () => {
    const departure = makePhase({ phase_type: 'departure', sequence_number: 3, status: 'in_progress' })
    tripState = { trip: makeTrip([departure]), isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'departure', slug: '4-departure' })
    // Completed but no blockchain_receipt_id yet — claiming "anchored" here would be
    // dishonest; the driver is pointed at the trip screen's own anchor progress UI.
    const freshTrip = makeTrip([{ ...departure, status: 'completed', blockchain_receipt_id: null }])
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: freshTrip, phaseStatus: 'completed' })
    mockRefetchTrip.mockResolvedValue(freshTrip)

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-departure'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'success',
          title: 'Departure recorded',
          body: expect.stringContaining('anchoring in progress'),
        }),
      ),
    )
    expect(mockNotify).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('anchored to Hedera HCS') }),
    )
  })

  it('an offline-queued departure submit (even in real mode) keeps the honest "stored on this device" wording — it never reached the backend, let alone Hedera', async () => {
    const departure = makePhase({ phase_type: 'departure', sequence_number: 3, status: 'in_progress' })
    tripState = { trip: makeTrip([departure]), isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'departure', slug: '4-departure' })
    mockSubmitPhase.mockRejectedValue(new TypeError('network down'))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-departure'))

    await waitFor(() => expect(mockEnqueuePhase).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Departure recorded',
        body: expect.stringContaining('stored on this device'),
      }),
    )
  })

  it('a terminal 4xx on departure fires no success toast at all (unaffected by the anchoring change)', async () => {
    const departure = makePhase({ phase_type: 'departure', sequence_number: 3, status: 'in_progress' })
    tripState = { trip: makeTrip([departure]), isLoading: false, refetchTrip: mockRefetchTrip }
    mockUseParams.mockReturnValue({ type: 'departure', slug: '4-departure' })
    mockSubmitPhase.mockRejectedValue(new ApiError(422, 'missing seal photo'))

    render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-departure'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })),
    )
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  })
})
