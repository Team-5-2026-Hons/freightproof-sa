// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.tripgate.test.tsx
//
// Regression coverage carried over from the deleted
// app/(app)/trip/handshake/[h]/step/[slug]/__tests__/HandshakeStepPageClient.tripgate.test.tsx,
// adapted to the phase model:
//
// Fix 1 (CRITICAL evidence-wipe bug): the (app) layout gates children on auth only, not
// on TripContext.isLoading — a hard reload, PWA relaunch, or push-notification deep link
// straight into a step URL used to mount the page while `trip` was still null.
// usePhaseDraft reads localStorage ONLY in a useState lazy initializer keyed off
// (tripId, phase_event_id), so it would initialize under the WRONG key if it mounted
// before the trip loaded, then the driver's next onUpdate() call would write
// {...emptyPrev, ...patch} over the CORRECT key — permanently erasing previously
// captured evidence. The fix keeps every draft-owning hook inside components that only
// mount once `trip` is real (PhaseStepContent -> PhaseStepRouter -> the XStep
// components). This test mounts with isLoading:true and a null trip, then lets the trip
// arrive on the SAME mount — the exact scenario a "trip already loaded" test never covers.
//
// Fix 2 (submit spinner / "Trip not found." flash): a submit can toggle TripContext's
// SHARED isLoading and, once confirmation's last step closes the trip, /trips/me/active
// legitimately returns null. Both used to knock the step UI out mid-submit. Workstream 1
// moved the submission itself into lib/submission/phase-submitter.ts, so this window is
// now the one between the hand-off and the route change actually committing — the guard
// still has to hold. useTrip is mocked here with a MUTABLE module-level value + manual
// rerender(), standing in for TripContext re-rendering its consumers mid-flight.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PhaseStepPageClient from '../PhaseStepPageClient'
import { authenticateTestDriver } from '@/lib/session/testing/custody'
import { writeDraft } from '@/lib/offline/retained-drafts'
import { __resetPhaseSubmitterForTests } from '@/lib/submission/phase-submitter'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'

const TRIP_ID = 'trip-gate-1'
const ACTIVATION_PE = 'pe-activation-1' as PhaseEventId
const ARRIVAL_PE = 'pe-arrival-1' as PhaseEventId
const CONFIRMATION_PE = 'pe-confirmation-1' as PhaseEventId

const mockUseParams = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()
const mockNotify = vi.fn()
const mockSubmitPhase = vi.fn()
const mockRefetchTrip = vi.fn()
const mockAdoptTrip = vi.fn()
const mockEnqueuePhase = vi.fn()
const mockMarkPhaseSyncing = vi.fn()
const mockClearPhaseSyncing = vi.fn()
const mockNoteTripCompleted = vi.fn()

interface MockTripState {
  trip: Trip | null
  isLoading: boolean
  refetchTrip: typeof mockRefetchTrip
  adoptTrip: typeof mockAdoptTrip
  syncingPhaseIds: readonly string[]
  markPhaseSyncing: typeof mockMarkPhaseSyncing
  clearPhaseSyncing: typeof mockClearPhaseSyncing
  noteTripCompleted: typeof mockNoteTripCompleted
}

let tripState: MockTripState

function setTripState(trip: Trip | null, isLoading: boolean): void {
  tripState = {
    trip,
    isLoading,
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

vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: mockNotify }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueuePhase: mockEnqueuePhase }),
}))
vi.mock('@/lib/api/phases', () => ({ submitPhase: (...args: unknown[]) => mockSubmitPhase(...args) }))

function SealVerifyStub({
  draft, onUpdate,
}: {
  draft: { sealNumberAtArrival: string | null }
  onUpdate: (patch: { sealCondition: string }) => void
}) {
  return (
    <div>
      <p>seal:{draft.sealNumberAtArrival ?? 'null'}</p>
      <button onClick={() => onUpdate({ sealCondition: 'intact' })}>patch-condition</button>
    </div>
  )
}

function ClosedStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-confirmation</button>
}

vi.mock('@/components/phase/steps/registry', () => ({
  stepComponentFor: (phaseType: string, slug: string) => {
    if (phaseType === 'arrival' && slug === '2-seal-verify') return SealVerifyStub
    if (phaseType === 'confirmation' && slug === '4-closed') return ClosedStub
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

function arrivalDraftKey(): string {
  return `fp_draft_${TRIP_ID}_${ARRIVAL_PE}`
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  authenticateTestDriver(TRIP_ID)
  __resetPhaseSubmitterForTests()
})

afterEach(() => {
  cleanup()
})

describe('trip-loading gate — drafts survive a mount that begins before the trip loads (Fix 1)', () => {
  it('loads a previously persisted draft under the real (tripId, phase_event_id) key, and the next update merges instead of wiping it', async () => {
    writeDraft(
      TRIP_ID, ARRIVAL_PE, { actorId: 'driver-1', custodySequence: 0 },
      {
        sealNumberAtArrival: 'AB-1234', sealCondition: null, gatePhotoArtifactId: null,
        sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: '2026-07-01T08:00:00Z',
      },
    )
    mockUseParams.mockReturnValue({ type: 'arrival', slug: '2-seal-verify' })
    setTripState(null, true)

    const { rerender } = render(<PhaseStepPageClient />)

    expect(screen.queryByText(/seal:/)).not.toBeInTheDocument()

    const trip = makeTrip([makePhase({
      phase_event_id: ARRIVAL_PE, phase_type: 'arrival', sequence_number: 4, status: 'in_progress',
    })])
    setTripState(trip, false)
    rerender(<PhaseStepPageClient />)
    expect(await screen.findByText('seal:AB-1234')).toBeInTheDocument()

    fireEvent.click(screen.getByText('patch-condition'))

    const stored = JSON.parse(localStorage.getItem(arrivalDraftKey()) ?? '{}') as { draft: {
      sealNumberAtArrival: string | null; sealCondition: string | null
    } }
    expect(stored.draft.sealNumberAtArrival).toBe('AB-1234')
    expect(stored.draft.sealCondition).toBe('intact')
  })
})

describe('submit keeps the step UI on screen (Fix 2)', () => {
  it('does not flash "Trip not found." after confirmation closes the trip while the toast and navigation are in flight', async () => {
    mockUseParams.mockReturnValue({ type: 'confirmation', slug: '4-closed' })
    const trip = makeTrip([makePhase({
      phase_event_id: CONFIRMATION_PE, phase_type: 'confirmation', sequence_number: 5, status: 'in_progress',
    })])
    setTripState(trip, false)
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: { ...trip, status: 'closed' }, phaseStatus: 'completed' })

    const { rerender } = render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-confirmation'))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/'))

    setTripState(null, false)
    rerender(<PhaseStepPageClient />)
    expect(screen.queryByText('Trip not found.')).not.toBeInTheDocument()
    expect(screen.getByText('submit-confirmation')).toBeInTheDocument()
  })
})
