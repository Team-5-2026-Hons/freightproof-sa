import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import InTransitPageClient from '../InTransitPageClient'
import { ROUTES } from '@/lib/constants/routes'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException, ExceptionId } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseSubmissionOutcome, PhaseSubmissionRequest } from '@/lib/submission/phase-submitter'

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()
const mockCapturePosition = vi.fn()
const mockRefetchTrip = vi.fn()
const mockAdoptTrip = vi.fn()
const mockMarkPhaseSyncing = vi.fn()
const mockClearPhaseSyncing = vi.fn()
const mockEnqueuePhase = vi.fn()
const mockNotify = vi.fn()
const mockStartPhaseSubmission = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: mockCapturePosition, recordHere: vi.fn() }),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueuePhase: mockEnqueuePhase }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

// The background submitter has its own dedicated suite (lib/submission/__tests__/
// phase-submitter.test.ts) — stubbed here so this suite is about what the hub HANDS OFF,
// not the submitter's own retry/queue/dedupe machinery.
vi.mock('@/lib/submission/phase-submitter', () => ({
  startPhaseSubmission: (request: PhaseSubmissionRequest) => mockStartPhaseSubmission(request),
}))

// The map has its own suite (components/map/__tests__/DriverMap.test.tsx) covering the
// whole degradation ladder. Stubbed here so this suite is about the hub, while still
// surfacing the fix the hub feeds it — the one thing the hub owns.
vi.mock('@/components/map/DriverMap', () => ({
  DriverMap: ({ position }: { position: { lat: number; lng: number } | null }) => (
    <div data-testid="driver-map">{position === null ? 'no-fix' : `${position.lat},${position.lng}`}</div>
  ),
}))

// Button is being reworked in a parallel task — stub it so this suite only
// exercises the hub's own behavior, not Button internals.
vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

// SwipeToConfirm drives real pointer-drag gesture APIs that are out of scope here (it has
// its own dedicated suite) — stub it to a plain button exposing its `onConfirm`, mirroring
// the Button stub above and the identical stub in CheckpointPageClient's test.
vi.mock('@/components/phase/SwipeToConfirm', () => ({
  SwipeToConfirm: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button onClick={onConfirm} disabled={disabled}>{label}</button>
  ),
}))

function makeException(overrides: Partial<TripException>): TripException {
  return {
    id: crypto.randomUUID() as ExceptionId,
    trip_id: 'trip-1',
    exception_type: 'cargo_damage',
    source: 'driver',
    severity: 'warning',
    description: 'Default description',
    phase_event_id: null,
    checkpoint_id: null,
    supporting_artifact_id: null,
    resolved: false,
    resolved_by_user_id: null,
    resolved_at: null,
    resolver_note: null,
    merkle_batch_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// Marks every phase up to and including `through` (by sequence_number) as completed —
// mirrors the identical local helper in lib/phase/__tests__/derive.test.ts.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

// The ledger shape this screen is actually shown in: everything through DEPARTURE
// resolved, in_transit PENDING. The backend stopped auto-closing in_transit on departure
// — it now stays open for the whole drive and is closed by advance_unloading when the
// driver arrives — so in_transit is `currentPhase()` the entire time this screen is up.
//
// This fixture previously resolved in_transit too, which made `unloading` current and
// quietly hid a real bug: "Arrive at destination" read the current phase's recipe, found
// unloading's steps in the test and in_transit's empty one in the app, and so passed here
// while dead-ending on a real phone. Anchored to the departure row by phase_type rather
// than a literal sequence number, so it cannot drift if the plan generator changes shape.
const DEPARTURE_SEQUENCE = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'departure')!.sequence_number
const DRIVING_PHASES = walk(SINGLE_LEG_PHASE_PLAN, DEPARTURE_SEQUENCE)

// The pending, stepless row the hub is standing on for the whole drive — the row Task
// 5's attestation flow submits against.
const IN_TRANSIT_PHASE = DRIVING_PHASES.find((p) => p.phase_type === 'in_transit')!

// The hub must render the CONTEXT exceptions list (mock/fetched + session-logged),
// not the trip.exceptions fetch snapshot — otherwise a just-submitted exception
// silently vanishes from the driver's view.
const baseTrip = {
  id: 'trip-1',
  trip_reference: 'TRP-2026-0041',
  planned_arrival_at: null,
  status: 'active',
  phases: DRIVING_PHASES,
  // Deliberately stale: only ONE exception here. The context list below has three.
  exceptions: [makeException({ description: 'Stale snapshot exception' })],
}

const JHB_FIX = { lat: -26.09421, lng: 28.13422, accuracyM: 12 }

// Longer than the component's own refresh interval, so advancing by this always crosses
// exactly one tick regardless of the interval's precise value.
const POLL_WINDOW_MS = 20_000

// Shared useTrip fields every test needs alongside trip/isLoading/exceptions, now that
// the swipe hands off a submission through them. Spread into each mockUseTrip return
// value rather than hoisted into one object literal, because a couple of tests override
// `trip` itself (e.g. the no-open-trip case).
const tripStateFields = {
  refetchTrip: mockRefetchTrip,
  adoptTrip: mockAdoptTrip,
  markPhaseSyncing: mockMarkPhaseSyncing,
  clearPhaseSyncing: mockClearPhaseSyncing,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no fix. Suites that are not about the map then perform no state update at
  // all after mount, which keeps them free of act() noise from a background capture.
  mockCapturePosition.mockResolvedValue(null)
  // Matches the real submitter's own return contract (lib/submission/phase-submitter.ts):
  // true unless a submission for that row is already running.
  mockStartPhaseSubmission.mockReturnValue(true)
  mockRefetchTrip.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('InTransitPageClient exceptions list (5b)', () => {
  it('renders the context exceptions list including session-logged ones, with the incremented count', () => {
    const sessionException = makeException({
      exception_type: 'cargo_damage',
      description: 'Pallet crushed during pothole impact on N3',
    })
    mockUseTrip.mockReturnValue({
      trip: baseTrip,
      isLoading: false,
      exceptions: [
        makeException({ exception_type: 'mechanical', description: 'Brake warning light' }),
        makeException({ exception_type: 'dispatcher_note', source: 'dispatcher', description: 'Expect delay at Montrose plaza' }),
        sessionException,
      ],
      ...tripStateFields,
    })

    render(<InTransitPageClient />)

    expect(screen.getByText('3 open exceptions')).toBeInTheDocument()
    expect(screen.getByText(/pallet crushed during pothole impact/i)).toBeInTheDocument()
    expect(screen.queryByText(/stale snapshot exception/i)).not.toBeInTheDocument()
  })

  it('excludes resolved exceptions from the open count', () => {
    mockUseTrip.mockReturnValue({
      trip: baseTrip,
      isLoading: false,
      exceptions: [
        makeException({ description: 'Still open' }),
        makeException({ description: 'Already handled', resolved: true }),
      ],
      ...tripStateFields,
    })

    render(<InTransitPageClient />)

    expect(screen.getByText('1 open exception')).toBeInTheDocument()
    expect(screen.queryByText(/already handled/i)).not.toBeInTheDocument()
  })
})

describe('InTransitPageClient expandable cards (5c)', () => {
  beforeEach(() => {
    mockUseTrip.mockReturnValue({
      trip: baseTrip,
      isLoading: false,
      exceptions: [
        makeException({
          exception_type: 'dispatcher_note',
          source: 'dispatcher',
          description: 'A very long dispatcher note that would normally be truncated after two lines of text.',
        }),
      ],
      ...tripStateFields,
    })
  })

  it('renders each card as a button, collapsed with line-clamp-2 and aria-expanded=false', () => {
    render(<InTransitPageClient />)

    const card = screen.getByRole('button', { expanded: false })
    const description = screen.getByText(/a very long dispatcher note/i)

    expect(card).toContainElement(description)
    expect(description).toHaveClass('line-clamp-2')
  })

  it('tapping a card removes the clamp and sets aria-expanded=true; tapping again re-clamps', () => {
    render(<InTransitPageClient />)

    const card = screen.getByRole('button', { expanded: false })
    fireEvent.click(card)

    expect(card).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/a very long dispatcher note/i)).not.toHaveClass('line-clamp-2')

    fireEvent.click(card)

    expect(card).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/a very long dispatcher note/i)).toHaveClass('line-clamp-2')
  })
})

describe('InTransitPageClient driving screen', () => {
  beforeEach(() => {
    mockUseTrip.mockReturnValue({ trip: baseTrip, isLoading: false, exceptions: [], ...tripStateFields })
  })

  it('offers panic, checkpoint, exception and arrival together, with panic always present', () => {
    render(<InTransitPageClient />)

    // Panic is the one control that must never be conditional or behind a scroll.
    expect(screen.getByRole('button', { name: 'Panic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /checkpoint/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log exception/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /arrive at destination/i })).toBeInTheDocument()
  })

  it('walks "Arrive at destination" past the pending, stepless in_transit row to the arrival step', () => {
    // Guards the premise: in_transit is CURRENT here (not resolved), and carries no
    // recipe. Without both, this test cannot detect the dead-end it exists to catch.
    const current = DRIVING_PHASES.find((p) => p.status !== 'completed')!
    expect(current.phase_type).toBe('in_transit')
    expect(STEP_SLUGS.in_transit).toHaveLength(0)

    render(<InTransitPageClient />)

    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    // Unloading recipe (shared/lib/constants/phase-meta.ts) is ['2-seal-verify',
    // '4-visual-count'] as of 2026-08-05 — '1-hand-waybill' was deleted, so the first
    // arrival step is now seal-verify.
    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/unloading/step/2-seal-verify')
  })

  it('never routes "Arrive at destination" back to a trip screen, which would loop', () => {
    // The regression itself: the old fallback returned ROUTES.activeTripDetail, whose
    // "Continue driving" CTA leads straight back here — a driver could not reach unloading.
    render(<InTransitPageClient />)

    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    expect(mockRouterPush).not.toHaveBeenCalledWith(ROUTES.activeTripDetail)
    expect(mockRouterPush).not.toHaveBeenCalledWith(ROUTES.trips)
  })

  it('routes panic, checkpoint and log-exception to their own screens', () => {
    render(<InTransitPageClient />)

    fireEvent.click(screen.getByRole('button', { name: 'Panic' }))
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.panic)

    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }))
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.checkpoint)

    fireEvent.click(screen.getByRole('button', { name: /log exception/i }))
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.exception)
  })

  it('takes a fix on open and feeds it to the map', async () => {
    mockCapturePosition.mockResolvedValue(JHB_FIX)

    render(<InTransitPageClient />)

    await waitFor(() => expect(mockCapturePosition).toHaveBeenCalled())
    expect(await screen.findByTestId('driver-map')).toHaveTextContent('-26.09421,28.13422')
  })

  it('refreshes the fix while open, and keeps the last good one when a capture fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockCapturePosition.mockResolvedValue(JHB_FIX)

    render(<InTransitPageClient />)
    await waitFor(() => expect(screen.getByTestId('driver-map')).toHaveTextContent('-26.09421,28.13422'))

    // A failed fix (warehouse roof, revoked permission) must never blank the map back to
    // "no position" — the driver still needs to see where they last were.
    mockCapturePosition.mockResolvedValue(null)
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_WINDOW_MS) })

    expect(mockCapturePosition.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getByTestId('driver-map')).toHaveTextContent('-26.09421,28.13422')
  })

  it('stops capturing once the driver leaves the screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockCapturePosition.mockResolvedValue(JHB_FIX)

    const { unmount } = render(<InTransitPageClient />)
    await waitFor(() => expect(mockCapturePosition).toHaveBeenCalled())

    unmount()
    const callsAtUnmount = mockCapturePosition.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_WINDOW_MS) })

    // POPIA: the capture window is this screen's lifetime and nothing wider.
    expect(mockCapturePosition.mock.calls.length).toBe(callsAtUnmount)
  })

  it('captures no position at all when there is no open trip', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, exceptions: [], ...tripStateFields })

    render(<InTransitPageClient />)

    // POPIA: no trip, no tracking.
    expect(mockCapturePosition).not.toHaveBeenCalled()
    expect(screen.getByText('Trip not found.')).toBeInTheDocument()
  })
})

// The swipe used to be navigation-only, discarding the driver's "I have arrived"
// attestation and leaving the backend to infer arrival from whenever the unloading
// paperwork happened to be submitted. Since 2026-08-09 the swipe hands that attestation
// to the background submitter (lib/submission/phase-submitter.ts) before navigating —
// the same hand-off model PhaseStepPageClient's final step already uses.
describe('InTransitPageClient arrival attestation (Task 5)', () => {
  beforeEach(() => {
    mockUseTrip.mockReturnValue({ trip: baseTrip, isLoading: false, exceptions: [], ...tripStateFields })
  })

  it('hands the in_transit phase to the background submitter', () => {
    render(<InTransitPageClient />)

    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    expect(mockStartPhaseSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseType: 'in_transit',
        phaseEventId: IN_TRANSIT_PHASE.phase_event_id,
      }),
    )
  })

  it('marks the row syncing before navigating', () => {
    render(<InTransitPageClient />)

    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    expect(mockMarkPhaseSyncing).toHaveBeenCalledWith(IN_TRANSIT_PHASE.phase_event_id)
    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/unloading/step/2-seal-verify')
    // Order matters: without it Home renders one frame with in_transit still pending and
    // isDriving() (lib/phase/derive.ts) still true.
    const markOrder = mockMarkPhaseSyncing.mock.invocationCallOrder[0]
    const pushOrder = mockRouterPush.mock.invocationCallOrder[0]
    expect(markOrder).toBeLessThan(pushOrder)
  })

  it('navigates even when a submission for this row is already running', () => {
    mockStartPhaseSubmission.mockReturnValue(false)

    render(<InTransitPageClient />)
    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    // Stranding the driver on the driving screen would only invite a third swipe — the
    // evidence is already on its way either way.
    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/unloading/step/2-seal-verify')
  })

  it('rolls the marker back when the ledger refuses the arrival', () => {
    render(<InTransitPageClient />)
    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    const request = mockStartPhaseSubmission.mock.calls[0][0] as PhaseSubmissionRequest
    const outcome: PhaseSubmissionOutcome = { kind: 'conflict', message: 'an earlier phase is unresolved' }
    act(() => request.onOutcome(outcome))

    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(IN_TRANSIT_PHASE.phase_event_id)
  })

  it('keeps the marker when the arrival is queued offline', () => {
    render(<InTransitPageClient />)
    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    const request = mockStartPhaseSubmission.mock.calls[0][0] as PhaseSubmissionRequest
    const outcome: PhaseSubmissionOutcome = { kind: 'queued' }
    act(() => request.onOutcome(outcome))

    // The queue holds the attestation and will replay it, so re-offering the swipe would
    // only invite a second copy.
    expect(mockClearPhaseSyncing).not.toHaveBeenCalled()
  })

  it('sends the driver to the trip screen when the arrival lands on a held trip', () => {
    // Why 'hold' is its own arm rather than folded into 'recorded': by the time this
    // outcome arrives the swipe has ALREADY pushed the driver onto the unloading step,
    // and a held trip can only 409 there. Landing them on a capture screen they cannot
    // submit, with no explanation, is the wrong failure direction.
    //
    // Unreachable today — nothing in the backend writes TripStatus.EXCEPTION_HOLD (see
    // _is_resolved's note in phase_service.py) — so this test exists to keep the hub in
    // step with PhaseStepPageClient.handleOutcome's own 'hold' arm, which is the parity
    // that comment claims and nothing else enforces.
    //
    // Cast because baseTrip is a hand-built literal shaped for this suite's render
    // assertions, not a full Trip; the component reads none of the absent fields on
    // this path.
    const heldTrip = { ...baseTrip, status: 'exception_hold' } as unknown as Trip

    render(<InTransitPageClient />)
    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    const request = mockStartPhaseSubmission.mock.calls[0][0] as PhaseSubmissionRequest
    const outcome: PhaseSubmissionOutcome = { kind: 'hold', trip: heldTrip }
    act(() => request.onOutcome(outcome))

    expect(mockAdoptTrip).toHaveBeenCalledWith(heldTrip)
    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(IN_TRANSIT_PHASE.phase_event_id)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Trip on hold' }),
    )
    // Last, not only: the swipe's own push to the unloading step came first, and the
    // redirect is what pulls the driver back off it.
    expect(mockRouterPush).toHaveBeenLastCalledWith(ROUTES.activeTripDetail)
  })
})

// FP-150: system-detected exceptions are withheld from the driver's own hub. They are
// automated, unreviewed detections ABOUT the driver — gps_mismatch (FP-145) asserts the
// phone and the truck disagree about where they are — and putting one in front of the
// person it concerns invites them to react to it on the road. The dispatcher still sees
// every exception; nothing leaves the evidence trail.

describe('InTransitPageClient exception visibility (FP-150)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides system-detected exceptions from the driver and excludes them from the count', () => {
    mockUseTrip.mockReturnValue({
      trip: baseTrip,
      isLoading: false,
      exceptions: [
        makeException({ exception_type: 'mechanical', source: 'driver', description: 'Brake warning light' }),
        makeException({ exception_type: 'gps_mismatch', source: 'system', description: 'Phone and vehicle positions disagree' }),
        makeException({ exception_type: 'route_deviation', source: 'system', description: 'Off the planned route' }),
      ],
      ...tripStateFields,
    })

    render(<InTransitPageClient />)

    expect(screen.getByText(/brake warning light/i)).toBeInTheDocument()
    expect(screen.queryByText(/positions disagree/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/off the planned route/i)).not.toBeInTheDocument()
    // Singular: one visible exception, not three.
    expect(screen.getByText('1 open exception')).toBeInTheDocument()
  })

  it('still shows dispatcher-raised exceptions, which the driver is meant to act on', () => {
    mockUseTrip.mockReturnValue({
      trip: baseTrip,
      isLoading: false,
      exceptions: [
        makeException({ exception_type: 'dispatcher_note', source: 'dispatcher', description: 'Expect delay at Montrose plaza' }),
      ],
      ...tripStateFields,
    })

    render(<InTransitPageClient />)

    expect(screen.getByText(/montrose plaza/i)).toBeInTheDocument()
  })

  it('renders no exceptions section when every open exception is system-detected', () => {
    mockUseTrip.mockReturnValue({
      trip: baseTrip,
      isLoading: false,
      exceptions: [
        makeException({ exception_type: 'gps_mismatch', source: 'system', description: 'Phone and vehicle positions disagree' }),
      ],
      ...tripStateFields,
    })

    render(<InTransitPageClient />)

    // The empty state is the common case, and it must read as "nothing to see" rather
    // than "0 open exceptions" hinting that something was filtered away.
    expect(screen.queryByText(/open exception/i)).not.toBeInTheDocument()
  })
})
