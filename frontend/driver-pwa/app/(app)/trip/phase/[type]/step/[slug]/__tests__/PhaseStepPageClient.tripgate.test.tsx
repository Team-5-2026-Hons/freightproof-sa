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
// Fix 2 (submit spinner / "Trip not found." flash): a submit awaits refetchTrip(), which
// toggles TripContext's SHARED isLoading — and once confirmation's last step closes the
// trip, that refetch legitimately returns null. Both used to knock the step UI out
// mid-submit. useTrip is mocked here with a MUTABLE module-level value + manual
// rerender(), standing in for TripContext re-rendering its consumers mid-flight.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PhaseStepPageClient from '../PhaseStepPageClient'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'

const TRIP_ID = 'trip-gate-1'
const ACTIVATION_PE = 'pe-activation-1' as PhaseEventId
const UNLOADING_PE = 'pe-unloading-1' as PhaseEventId
const CONFIRMATION_PE = 'pe-confirmation-1' as PhaseEventId

const mockUseParams = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()
const mockNotify = vi.fn()
const mockSubmitPhase = vi.fn()
const mockRefetchTrip = vi.fn()
// The success path adopts the trip the submit already returned instead of refetching it.
const mockAdoptTrip = vi.fn()
const mockEnqueuePhase = vi.fn()

interface MockTripState {
  trip: Trip | null
  isLoading: boolean
  refetchTrip: typeof mockRefetchTrip
  adoptTrip: typeof mockAdoptTrip
}

// Reassigned mid-test (then rerender()ed) to simulate TripContext's shared state moving
// under an already-mounted page.
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

// usePhaseDraft/useSealReference/useVisualCountCarry are deliberately REAL here — the
// whole bug lives in their localStorage lazy initializers, so mocking them would test
// nothing. Step components are stubbed via the registry (components/phase/ is out of
// scope for this task and stubbing the lookup point avoids depending on 16 real
// components' own internals).
// Unloading, not activation: activation's draft is down to capturedAt now that its GPS
// is captured silently at submit, so it no longer holds evidence worth proving survives
// a cold start. Unloading's seal number and visual count are exactly that kind of
// evidence — typed by the driver, expensive to re-capture, and lost forever if a
// mid-flight reload wipes the draft.
function SealVerifyStub({
  draft, onUpdate,
}: {
  draft: { sealNumberAtDestination: string | null }
  onUpdate: (patch: { driverVisualCount: number }) => void
}) {
  return (
    <div>
      <p>seal:{draft.sealNumberAtDestination ?? 'null'}</p>
      <button onClick={() => onUpdate({ driverVisualCount: 31 })}>patch-count</button>
    </div>
  )
}

function ClosedStub({ onComplete }: { onComplete: () => void }) {
  return <button onClick={onComplete}>submit-confirmation</button>
}

vi.mock('@/components/phase/steps/registry', () => ({
  stepComponentFor: (phaseType: string, slug: string) => {
    if (phaseType === 'unloading' && slug === '2-seal-verify') return SealVerifyStub
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

function unloadingDraftKey(): string {
  return `fp_draft_${TRIP_ID}_${UNLOADING_PE}`
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('trip-loading gate — drafts survive a mount that begins before the trip loads (Fix 1)', () => {
  it('loads a previously persisted draft under the real (tripId, phase_event_id) key, and the next update merges instead of wiping it', async () => {
    // The driver typed the destination seal on an earlier session; then the app
    // cold-starts straight onto the step URL (reload / relaunch / notification deep link).
    localStorage.setItem(
      unloadingDraftKey(),
      JSON.stringify({
        waybillHandedOver: null, sealNumberAtDestination: 'AB-1234', sealVerifiedMatch: null,
        sealBrokenPhotoDataUrl: null, driverVisualCount: null, capturedAt: '2026-07-01T08:00:00Z',
      }),
    )
    mockUseParams.mockReturnValue({ type: 'unloading', slug: '2-seal-verify' })
    tripState = { trip: null, isLoading: true, refetchTrip: mockRefetchTrip, adoptTrip: mockAdoptTrip }

    const { rerender } = render(<PhaseStepPageClient />)

    // While TripContext is still loading, the step — and therefore usePhaseDraft's lazy
    // initializer — must not have mounted at all. Before the fix it would have mounted
    // here with tripId = '' and initialized empty state under the wrong key.
    expect(screen.queryByText(/seal:/)).not.toBeInTheDocument()

    // The trip arrives on the SAME mount. The step appears with the persisted draft —
    // not an empty ACTIVATION_INITIAL.
    const trip = makeTrip([makePhase({
      phase_event_id: UNLOADING_PE, phase_type: 'unloading', sequence_number: 4, status: 'in_progress',
    })])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip, adoptTrip: mockAdoptTrip }
    rerender(<PhaseStepPageClient />)
    expect(await screen.findByText('seal:AB-1234')).toBeInTheDocument()

    // The next onUpdate must MERGE into the stored draft. The buggy version would have
    // written {...emptyPrev, ...patch} to the real key here, erasing the typed seal.
    fireEvent.click(screen.getByText('patch-count'))

    const stored = JSON.parse(localStorage.getItem(unloadingDraftKey()) ?? '{}') as {
      sealNumberAtDestination: string | null; driverVisualCount: number | null
    }
    expect(stored.sealNumberAtDestination).toBe('AB-1234') // previously captured evidence survived
    expect(stored.driverVisualCount).toBe(31) // and the new patch landed alongside it
  })
})

describe('submit keeps the step UI on screen (Fix 2)', () => {
  it('does not flash "Trip not found." after confirmation closes the trip while the toast and navigation are in flight', async () => {
    mockUseParams.mockReturnValue({ type: 'confirmation', slug: '4-closed' })
    const trip = makeTrip([makePhase({
      phase_event_id: CONFIRMATION_PE, phase_type: 'confirmation', sequence_number: 5, status: 'in_progress',
    })])
    tripState = { trip, isLoading: false, refetchTrip: mockRefetchTrip, adoptTrip: mockAdoptTrip }
    mockSubmitPhase.mockResolvedValue({ ok: true, trip: { ...trip, status: 'closed' }, phaseStatus: 'completed' })
    mockRefetchTrip.mockImplementation(() => {
      // Once confirmation submits the trip is CLOSED — /trips/me/active legitimately
      // has nothing left to return, so the shared trip goes null while this page is
      // still mounted (navigation hasn't unmounted it yet).
      tripState = { trip: null, isLoading: false, refetchTrip: mockRefetchTrip, adoptTrip: mockAdoptTrip }
      return Promise.resolve(null)
    })

    const { rerender } = render(<PhaseStepPageClient />)
    fireEvent.click(screen.getByText('submit-confirmation'))
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled())

    // The shared trip is now null but navigation hasn't unmounted the page yet (the
    // mocked router stands in for the in-flight push) — the step must still render
    // rather than the "Trip not found." dead-end.
    rerender(<PhaseStepPageClient />)
    expect(screen.queryByText('Trip not found.')).not.toBeInTheDocument()
    expect(screen.getByText('submit-confirmation')).toBeInTheDocument()
  })
})
