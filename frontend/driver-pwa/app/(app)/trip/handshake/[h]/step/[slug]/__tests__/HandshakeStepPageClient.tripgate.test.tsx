// frontend/driver-pwa/app/(app)/trip/handshake/[h]/step/[slug]/__tests__/HandshakeStepPageClient.tripgate.test.tsx
//
// Regression coverage for the trip-loading gate in HandshakeStepPageClient.
//
// Fix 1 (CRITICAL evidence-wipe bug): the (app) layout gates children on auth only,
// not on TripContext.isLoading — so a hard reload, PWA relaunch, or push-notification
// deep link straight into a step URL used to mount the page while `trip` was still
// null. useHandshakeDraft/useSealReference read localStorage ONLY in a useState lazy
// initializer keyed off tripId, so they initialized under the WRONG keys
// (`fp_draft__<type>` / `fp:seal-reference:`), started empty, and the driver's next
// updateDraft() wrote {...emptyPrev, ...patch} over the CORRECT key — permanently
// erasing previously captured photos/GPS/seal evidence. The fix moves those hooks into
// HandshakeStepContent, which only mounts once `trip` is real. These tests mount with
// isLoading:true and a null trip, then let the trip arrive on the SAME mount — the
// exact scenario SealReferencePersistence.test.tsx never covers (it always mocks a
// resolved trip).
//
// Fix 2 (submit spinner/"Trip not found." flash): submitAndAdvance awaits
// refetchTrip(), which toggles TripContext's SHARED isLoading — and after H5 closes
// the trip, the refetch legitimately returns null. Both used to knock the step UI out
// mid-submit (full-screen spinner / "Trip not found.") while HoldButton was already
// showing its own "Submitting…" progress. useTrip is mocked here with a MUTABLE
// module-level value + manual rerender(), standing in for TripContext re-rendering its
// consumers mid-flight.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import HandshakeStepPageClient from '../HandshakeStepPageClient'

const TRIP_ID = 'trip-gate-1'

const mockUseParams = vi.fn()
const mockRouterPush = vi.fn()
const mockNotify = vi.fn()
const mockSubmitHandshake = vi.fn()
const mockRefetchTrip = vi.fn()

// The shape the component actually consumes from useTrip() — kept minimal on purpose;
// this suite drives the gate, not TripContext.
interface MockTripState {
  trip: { id: string; status: string } | null
  isLoading: boolean
  refetchTrip: typeof mockRefetchTrip
}

// Reassigned mid-test (then rerender()ed) to simulate TripContext's shared state moving
// under an already-mounted page: the initial fetch resolving, refetchTrip flipping the
// shared isLoading, or the active trip disappearing after H5 closes it.
let tripState: MockTripState

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({ useTrip: () => tripState }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: mockNotify }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ enqueue: vi.fn() }) }))
vi.mock('@/lib/api/handshakes', () => ({ submitHandshake: (...args: unknown[]) => mockSubmitHandshake(...args) }))

// useHandshakeDraft/useSealReference are deliberately REAL here — the whole bug lives
// in their localStorage lazy initializers, so mocking them would test nothing. Steps
// are stubbed (parallel work touches step internals constantly); the ones under test
// surface exactly the plumbing each test asserts on.
vi.mock('@/components/handshake/steps/H1GateArrival', () => ({
  H1GateArrival: ({ draft, onUpdate }: { draft: { gpsLat: number | null }; onUpdate: (patch: { gpsLng: number }) => void }) => (
    <div>
      <p>h1-lat:{draft.gpsLat ?? 'null'}</p>
      <button onClick={() => onUpdate({ gpsLng: 28.13 })}>patch-h1</button>
    </div>
  ),
}))
vi.mock('@/components/handshake/steps/H1Verification', () => ({ H1Verification: () => null }))
vi.mock('@/components/handshake/steps/H2ArriveBay', () => ({ H2ArriveBay: () => null }))
vi.mock('@/components/handshake/steps/H2Linehaul', () => ({ H2Linehaul: () => null }))
vi.mock('@/components/handshake/steps/H2Waybill', () => ({ H2Waybill: () => null }))
vi.mock('@/components/handshake/steps/H2Seal', () => ({ H2Seal: () => null }))
vi.mock('@/components/handshake/steps/H2Review', () => ({ H2Review: () => null }))
vi.mock('@/components/handshake/steps/H3ApproachExit', () => ({ H3ApproachExit: () => null }))
vi.mock('@/components/handshake/steps/H3ExitSeal', () => ({
  H3ExitSeal: ({ h2SealNumber }: { h2SealNumber: string | null }) => <p>h3-seal:{h2SealNumber ?? 'null'}</p>,
}))
vi.mock('@/components/handshake/steps/H3Departure', () => ({ H3Departure: () => null }))
vi.mock('@/components/handshake/steps/H4ApproachDest', () => ({ H4ApproachDest: () => null }))
vi.mock('@/components/handshake/steps/H4SealVerify', () => ({
  H4SealVerify: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>complete-h4</button>,
}))
vi.mock('@/components/handshake/steps/H5HandWaybill', () => ({ H5HandWaybill: () => null }))
vi.mock('@/components/handshake/steps/H5SealInspection', () => ({ H5SealInspection: () => null }))
vi.mock('@/components/handshake/steps/H5VisualCount', () => ({ H5VisualCount: () => null }))
vi.mock('@/components/handshake/steps/H5PodPhoto', () => ({ H5PodPhoto: () => null }))
vi.mock('@/components/handshake/steps/H5Reconciliation', () => ({ H5Reconciliation: () => null }))
vi.mock('@/components/handshake/steps/H5Closed', () => ({
  H5Closed: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>submit-h5</button>,
}))

function h1DraftKey(): string {
  return `fp_draft_${TRIP_ID}_origin_gate_in`
}

function sealReferenceKey(): string {
  return `fp:seal-reference:${TRIP_ID}`
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('trip-loading gate — drafts survive a mount that begins before the trip loads (Fix 1)', () => {
  it('loads a previously persisted draft under the real tripId key, and the next update merges instead of wiping it', async () => {
    // The driver captured GPS at H1 on an earlier session; then the app cold-starts
    // straight onto the step URL (reload / relaunch / notification deep link).
    localStorage.setItem(
      h1DraftKey(),
      JSON.stringify({ gpsLat: -26.09, gpsLng: null, gateAddress: null, capturedAt: '2026-07-01T08:00:00Z' }),
    )
    mockUseParams.mockReturnValue({ h: '1', slug: '1-approach-gate' })
    tripState = { trip: null, isLoading: true, refetchTrip: mockRefetchTrip }

    const { rerender } = render(<HandshakeStepPageClient />)

    // While TripContext is still loading, the step — and therefore the draft hooks'
    // lazy initializers — must not have mounted at all. Before the fix they mounted
    // here with tripId = '' and initialized empty state under the wrong keys.
    expect(screen.queryByText(/h1-lat:/)).not.toBeInTheDocument()

    // The trip arrives on the SAME mount. The step appears with the persisted draft —
    // not the empty H1_INITIAL the buggy version started from.
    tripState = { trip: { id: TRIP_ID, status: 'created' }, isLoading: false, refetchTrip: mockRefetchTrip }
    rerender(<HandshakeStepPageClient />)
    expect(await screen.findByText('h1-lat:-26.09')).toBeInTheDocument()

    // The next updateDraft must MERGE into the stored draft. The buggy version wrote
    // {...emptyPrev, ...patch} to the real key here — erasing the captured GPS lat.
    fireEvent.click(screen.getByText('patch-h1'))

    const stored = JSON.parse(localStorage.getItem(h1DraftKey()) ?? '{}') as { gpsLat: number | null; gpsLng: number | null }
    expect(stored.gpsLat).toBe(-26.09) // previously captured evidence survived
    expect(stored.gpsLng).toBe(28.13)  // and the new patch landed alongside it
  })

  it('the seal reference is also read under the real tripId once the trip arrives', async () => {
    // Seal set at H2 loading on an earlier session; cold-start deep link into H3.
    localStorage.setItem(sealReferenceKey(), 'FP-1234')
    mockUseParams.mockReturnValue({ h: '3', slug: '2-exit-and-seal' })
    tripState = { trip: null, isLoading: true, refetchTrip: mockRefetchTrip }

    const { rerender } = render(<HandshakeStepPageClient />)
    expect(screen.queryByText(/h3-seal:/)).not.toBeInTheDocument()

    tripState = { trip: { id: TRIP_ID, status: 'loading' }, isLoading: false, refetchTrip: mockRefetchTrip }
    rerender(<HandshakeStepPageClient />)

    // Before the fix, useSealReference had already initialized to null under
    // 'fp:seal-reference:' (empty tripId) and H3 saw no seal to compare against.
    expect(await screen.findByText('h3-seal:FP-1234')).toBeInTheDocument()
  })
})

describe('submit keeps the step UI on screen (Fix 2)', () => {
  it('does not fall into the full-screen spinner while a submit\'s refetch toggles the shared isLoading', async () => {
    mockUseParams.mockReturnValue({ h: '4', slug: '2-seal-verify' })
    tripState = { trip: { id: TRIP_ID, status: 'in_transit' }, isLoading: false, refetchTrip: mockRefetchTrip }
    mockSubmitHandshake.mockResolvedValue({ ok: true, trip: null })

    // refetchTrip flips TripContext's shared isLoading for its whole duration — hold
    // it pending so the test can assert the render inside that window.
    let resolveRefetch!: (trip: { id: string; status: string }) => void
    mockRefetchTrip.mockImplementation(() => {
      tripState = { ...tripState, isLoading: true }
      return new Promise((resolve) => { resolveRefetch = resolve })
    })

    const { rerender } = render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('complete-h4'))
    await waitFor(() => expect(mockRefetchTrip).toHaveBeenCalled())

    // Shared isLoading is now true; this rerender stands in for TripContext
    // re-rendering its consumers. Before the fix this render replaced the step (and
    // HoldButton's own "Submitting…" state) with the full-screen spinner.
    rerender(<HandshakeStepPageClient />)
    expect(screen.getByText('complete-h4')).toBeInTheDocument()

    // Let the submit finish normally — it should toast and route onward.
    tripState = { trip: { id: TRIP_ID, status: 'dest_gate_in' }, isLoading: false, refetchTrip: mockRefetchTrip }
    resolveRefetch({ id: TRIP_ID, status: 'dest_gate_in' })
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  })

  it('does not flash "Trip not found." after H5 closes the trip while the toast and navigation are in flight', async () => {
    mockUseParams.mockReturnValue({ h: '5', slug: '6-closed' })
    tripState = { trip: { id: TRIP_ID, status: 'dest_gate_in' }, isLoading: false, refetchTrip: mockRefetchTrip }
    mockSubmitHandshake.mockResolvedValue({ ok: true, trip: null })
    mockRefetchTrip.mockImplementation(() => {
      // After H5 the trip is CLOSED — /trips/me/active legitimately has nothing left
      // to return, so the shared trip goes null while this page is still mounted.
      tripState = { trip: null, isLoading: false, refetchTrip: mockRefetchTrip }
      return Promise.resolve(null)
    })

    const { rerender } = render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h5'))
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled())

    // The shared trip is now null but navigation hasn't unmounted the page yet (the
    // mocked router stands in for the in-flight push) — the step must still render
    // rather than the "Trip not found." dead-end.
    rerender(<HandshakeStepPageClient />)
    expect(screen.queryByText('Trip not found.')).not.toBeInTheDocument()
    expect(screen.getByText('submit-h5')).toBeInTheDocument()
  })
})
