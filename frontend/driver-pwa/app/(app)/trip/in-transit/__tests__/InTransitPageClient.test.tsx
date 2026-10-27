import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import InTransitPageClient from '../InTransitPageClient'
import { ROUTES } from '@/lib/constants/routes'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException, ExceptionId } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
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
const mockLocationCapture = vi.fn()
const mockPreviewPhaseLocation = vi.fn()
const mockUseTripRoute = vi.fn()

const ARRIVAL_CAPTURE = {
  latitude: -26.09421,
  longitude: 28.13422,
  accuracy: 12,
  capturedAt: '2026-09-15T10:00:00Z',
}

const ARRIVAL_PASS = {
  schema_version: 1 as const,
  policy_version: '2026-09-15.1',
  evaluated_at: '2026-09-15T10:00:01Z',
  driver_lat: ARRIVAL_CAPTURE.latitude, driver_lng: ARRIVAL_CAPTURE.longitude,
  driver_captured_at: ARRIVAL_CAPTURE.capturedAt, driver_accuracy_metres: ARRIVAL_CAPTURE.accuracy,
  tracker_lat: ARRIVAL_CAPTURE.latitude, tracker_lng: ARRIVAL_CAPTURE.longitude,
  tracker_captured_at: '2026-09-15T10:00:01Z', separation_metres: 5,
  proximity: 'within_limit' as const, reasons: [], max_separation_metres: 100,
  max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
  expected_trip_stop_id: 'stop-1', precinct_id: 'precinct-1', precinct_lat: null, precinct_lng: null,
  precinct_radius_metres: null, precinct_tolerance_metres: null, driver_in_precinct: true, truck_in_precinct: true,
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: mockCapturePosition, recordHere: vi.fn() }),
}))
vi.mock('@/lib/hooks/useLocation', () => ({
  useLocation: () => ({ capture: () => mockLocationCapture() }),
}))
vi.mock('@/lib/hooks/useTripRoute', () => ({
  useTripRoute: () => mockUseTripRoute(),
}))
vi.mock('@/lib/api/phases', () => ({
  previewPhaseLocation: (...args: unknown[]) => mockPreviewPhaseLocation(...args),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueuePhase: mockEnqueuePhase }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

vi.mock('@/lib/submission/phase-submitter', () => ({
  startPhaseSubmission: (request: PhaseSubmissionRequest) => mockStartPhaseSubmission(request),
}))

vi.mock('@/lib/hooks/useMyTrips', () => ({
  useMyTrips: () => ({
    trips: [{ id: 'trip-1', origin_precinct_name: 'FedEx JHB · Linbro Park', destination_precinct_name: 'FedEx DBN · Riverhorse Valley' }],
    isLoading: false, loadError: null, reload: vi.fn(),
  }),
}))

vi.mock('@/components/map/DriverMap', () => ({
  DriverMap: ({ position, route, extraAction }: { position: { lat: number; lng: number } | null; route?: readonly unknown[] | null; extraAction?: React.ReactNode }) => (
    <div data-testid="driver-map" data-route-points={route?.length ?? 0}>
      {position === null ? 'no-fix' : `${position.lat},${position.lng}`}
      {extraAction}
    </div>
  ),
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

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
    review_status: 'recorded',
    review_outcome: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_note: null,
    contact_method: null,
    vehicle_id: null,
    merkle_batch_id: null,
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_name: null,
    reviewed_by_name: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

const DEPARTURE_SEQUENCE = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'departure')!.sequence_number
const DRIVING_PHASES = walk(SINGLE_LEG_PHASE_PLAN, DEPARTURE_SEQUENCE)

const IN_TRANSIT_PHASE = DRIVING_PHASES.find((p) => p.phase_type === 'in_transit')!

const baseTrip = {
  id: 'trip-1',
  trip_reference: 'TRP-2026-0041',
  planned_arrival_at: null,
  status: 'active',
  phases: DRIVING_PHASES,
  exceptions: [makeException({ description: 'Stale snapshot exception' })],
}

const JHB_FIX = { lat: -26.09421, lng: 28.13422, accuracyM: 12 }

const POLL_WINDOW_MS = 20_000

const tripStateFields = {
  refetchTrip: mockRefetchTrip,
  adoptTrip: mockAdoptTrip,
  markPhaseSyncing: mockMarkPhaseSyncing,
  clearPhaseSyncing: mockClearPhaseSyncing,
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  mockCapturePosition.mockResolvedValue(null)
  mockStartPhaseSubmission.mockReturnValue(true)
  mockRefetchTrip.mockResolvedValue(null)
  mockLocationCapture.mockResolvedValue(ARRIVAL_CAPTURE)
  mockPreviewPhaseLocation.mockResolvedValue(ARRIVAL_PASS)
  mockUseTripRoute.mockReturnValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

async function confirmArrival(): Promise<PhaseSubmissionRequest> {
  fireEvent.click(screen.getByRole('button', { name: /swipe to arrive/i }))
  await waitFor(() => expect(mockStartPhaseSubmission).toHaveBeenCalledTimes(1))
  return mockStartPhaseSubmission.mock.calls[0][0] as PhaseSubmissionRequest
}


/** The open-exception cards, counted inside their section — no count eyebrow is drawn. */
function openExceptionCards() {
  return within(screen.getByRole('region', { name: 'Open exceptions' })).getAllByRole('button')
}

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

    expect(openExceptionCards()).toHaveLength(3)
    expect(screen.getByText(/pallet crushed during pothole impact/i)).toBeInTheDocument()
    expect(screen.queryByText(/stale snapshot exception/i)).not.toBeInTheDocument()
  })

  it('excludes reviewed exceptions from the open count', () => {
    mockUseTrip.mockReturnValue({
      trip: baseTrip,
      isLoading: false,
      exceptions: [
        makeException({ description: 'Still open' }),
        makeException({ description: 'Already handled', review_status: 'reviewed' }),
      ],
      ...tripStateFields,
    })

    render(<InTransitPageClient />)

    expect(openExceptionCards()).toHaveLength(1)
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

  it('renders each card as a button, collapsed to one clamped line and aria-expanded=false', () => {
    render(<InTransitPageClient />)

    const card = screen.getByRole('button', { expanded: false })
    const description = screen.getByText(/a very long dispatcher note/i)

    expect(card).toContainElement(description)
    expect(description).toHaveClass('line-clamp-1')
  })

  it('shows that a card expands, and marks it as an alert without a thick side stripe', () => {
    render(<InTransitPageClient />)
    const card = screen.getByRole('button', { expanded: false })

    expect(card.querySelector('svg.lucide-chevron-down')).not.toBeNull()
    expect(card).not.toHaveClass('border-l-4')
  })

  it('tapping a card removes the clamp and sets aria-expanded=true; tapping again re-clamps', () => {
    render(<InTransitPageClient />)

    const card = screen.getByRole('button', { expanded: false })
    fireEvent.click(card)

    expect(card).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/a very long dispatcher note/i)).not.toHaveClass('line-clamp-1')

    fireEvent.click(card)

    expect(card).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/a very long dispatcher note/i)).toHaveClass('line-clamp-1')
  })
})

describe('InTransitPageClient driving screen', () => {
  beforeEach(() => {
    mockUseTrip.mockReturnValue({ trip: baseTrip, isLoading: false, exceptions: [], ...tripStateFields })
  })

  it('offers panic, checkpoint, exception and arrival together, with panic always present', () => {
    render(<InTransitPageClient />)

    expect(screen.getByRole('button', { name: 'Panic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /checkpoint/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log exception/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /swipe to arrive/i })).toBeInTheDocument()
  })

  it('test_shows_where_the_truck_is_heading_and_when_it_is_due', () => {
    mockUseTrip.mockReturnValue({
      trip: { ...baseTrip, planned_arrival_at: '2026-05-09T17:30:00Z' }, isLoading: false, exceptions: [], ...tripStateFields,
    })

    render(<InTransitPageClient />)

    expect(screen.getByText('Heading to')).toBeInTheDocument()
    expect(screen.getByText('FedEx DBN')).toBeInTheDocument()
    expect(screen.getByText('Riverhorse Valley')).toBeInTheDocument()
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument()
  })

  it('test_offers_navigate_to_a_destination_the_phone_can_place', () => {
    mockUseTrip.mockReturnValue({
      trip: { ...baseTrip, destination_precinct_id: String(mockPrecincts[1].id) }, isLoading: false, exceptions: [], ...tripStateFields,
    })

    render(<InTransitPageClient />)

    expect(screen.getByRole('link', { name: /navigate/i })).toHaveAttribute('href', expect.stringContaining('destination='))
  })

  it('test_offers_no_navigate_when_the_destination_is_unknown', () => {
    render(<InTransitPageClient />)

    expect(screen.queryByRole('link', { name: /navigate/i })).toBeNull()
  })

  it('test_keeps_a_way_back_over_the_map', () => {
    render(<InTransitPageClient />)

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('keeps Panic outside the region that scrolls, so it can never be scrolled away', () => {
    render(<InTransitPageClient />)

    let node: HTMLElement | null = screen.getByRole('button', { name: 'Panic' })
    const scrollers: HTMLElement[] = []
    while (node) {
      if (node.classList.contains('overflow-y-auto')) scrollers.push(node)
      node = node.parentElement
    }

    expect(scrollers).toEqual([])
  })

  it('walks "Arrive at Destination" past the pending, stepless in_transit row to the arrival step', async () => {
    const current = DRIVING_PHASES.find((p) => p.status !== 'completed')!
    expect(current.phase_type).toBe('in_transit')
    expect(STEP_SLUGS.in_transit).toHaveLength(0)

    render(<InTransitPageClient />)

    await confirmArrival()

    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/arrival/step/2-seal-verify')
  })

  it('never routes "Arrive at Destination" back to a trip screen, which would loop', async () => {
    render(<InTransitPageClient />)

    await confirmArrival()

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

    expect(mockCapturePosition.mock.calls.length).toBe(callsAtUnmount)
  })

  it('captures no position at all when there is no open trip', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, exceptions: [], ...tripStateFields })

    render(<InTransitPageClient />)

    expect(mockCapturePosition).not.toHaveBeenCalled()
    expect(screen.getByText('Trip not found.')).toBeInTheDocument()
  })
})

describe('InTransitPageClient arrival attestation', () => {
  beforeEach(() => {
    mockUseTrip.mockReturnValue({ trip: baseTrip, isLoading: false, exceptions: [], ...tripStateFields })
  })

  it('hands the in_transit phase to the background submitter', async () => {
    render(<InTransitPageClient />)

    await confirmArrival()

    expect(mockStartPhaseSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseType: 'in_transit',
        phaseEventId: IN_TRANSIT_PHASE.phase_event_id,
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('marks the row syncing before navigating', async () => {
    render(<InTransitPageClient />)

    await confirmArrival()

    expect(mockMarkPhaseSyncing).toHaveBeenCalledWith(IN_TRANSIT_PHASE.phase_event_id)
    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/arrival/step/2-seal-verify')
    const markOrder = mockMarkPhaseSyncing.mock.invocationCallOrder[0]
    const pushOrder = mockRouterPush.mock.invocationCallOrder[0]
    expect(markOrder).toBeLessThan(pushOrder)
  })

  it('navigates even when a submission for this row is already running', async () => {
    mockStartPhaseSubmission.mockReturnValue(false)

    render(<InTransitPageClient />)
    await confirmArrival()

    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/arrival/step/2-seal-verify')
  })

  it('rolls the marker back when the ledger refuses the arrival', async () => {
    render(<InTransitPageClient />)
    const request = await confirmArrival()
    const outcome: PhaseSubmissionOutcome = { kind: 'conflict', message: 'an earlier phase is unresolved' }
    act(() => request.onOutcome(outcome))

    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(IN_TRANSIT_PHASE.phase_event_id)
  })

  it('keeps the marker when the arrival is queued offline', async () => {
    render(<InTransitPageClient />)
    const request = await confirmArrival()
    const outcome: PhaseSubmissionOutcome = { kind: 'queued' }
    act(() => request.onOutcome(outcome))

    expect(mockClearPhaseSyncing).not.toHaveBeenCalled()
  })

  it('sends the driver to the trip screen when the arrival lands on a held trip', async () => {
    const heldTrip = { ...baseTrip, status: 'exception_hold' } as unknown as Trip

    render(<InTransitPageClient />)
    const request = await confirmArrival()
    const outcome: PhaseSubmissionOutcome = { kind: 'hold', trip: heldTrip }
    act(() => request.onOutcome(outcome))

    expect(mockAdoptTrip).toHaveBeenCalledWith(heldTrip)
    expect(mockClearPhaseSyncing).toHaveBeenCalledWith(IN_TRANSIT_PHASE.phase_event_id)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Trip on hold' }),
    )
    expect(mockRouterPush).toHaveBeenLastCalledWith(ROUTES.activeTripDetail)
  })

  it('retries a reliable mismatch with a replacement capture and submits the driver reason', async () => {
    const retryCapture = { ...ARRIVAL_CAPTURE, latitude: -26.095, capturedAt: '2026-09-15T10:01:00Z' }
    const mismatch = { ...ARRIVAL_PASS, proximity: 'separated' as const, separation_metres: 320 }
    mockLocationCapture.mockResolvedValueOnce(ARRIVAL_CAPTURE).mockResolvedValueOnce(retryCapture)
    mockPreviewPhaseLocation.mockResolvedValue(mismatch)

    render(<InTransitPageClient />)
    fireEvent.click(screen.getByRole('button', { name: /swipe to arrive/i }))

    await screen.findByText('320 m apart')
    fireEvent.click(screen.getByRole('button', { name: 'Retry Location' }))
    await waitFor(() => expect(mockPreviewPhaseLocation).toHaveBeenLastCalledWith(
      'trip-1', IN_TRANSIT_PHASE.phase_event_id,
      expect.objectContaining({ lat: retryCapture.latitude, captured_at: retryCapture.capturedAt }),
    ))
    fireEvent.change(screen.getByLabelText('Reason for continuing'), { target: { value: 'Truck is at the gate.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Exception' }))

    await waitFor(() => expect(mockStartPhaseSubmission).toHaveBeenCalledWith(expect.objectContaining({
      driverCapturedAt: retryCapture.capturedAt,
      acknowledgement: expect.objectContaining({ reason: 'Truck is at the gate.' }),
    })))
  })

  it('captures and preserves an offline arrival, then requires explicit non-accusatory continuation', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    try {
      render(<InTransitPageClient />)
      fireEvent.click(screen.getByRole('button', { name: /swipe to arrive/i }))

      await screen.findByText('Location not verified while offline.')
      await screen.findByText('We could not compare your location with the truck. Your action can still be recorded.')
      expect(mockPreviewPhaseLocation).not.toHaveBeenCalled()
      expect(mockStartPhaseSubmission).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await waitFor(() => expect(mockStartPhaseSubmission).toHaveBeenCalledTimes(1))
      const request = mockStartPhaseSubmission.mock.calls[0][0] as PhaseSubmissionRequest

      expect(await request.position).toEqual({
        lat: ARRIVAL_CAPTURE.latitude,
        lng: ARRIVAL_CAPTURE.longitude,
        accuracyM: ARRIVAL_CAPTURE.accuracy,
        capturedAt: ARRIVAL_CAPTURE.capturedAt,
      })
      expect(request.driverCapturedAt).toBe(ARRIVAL_CAPTURE.capturedAt)
      expect(request.acknowledgement).toBeNull()
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
    }
  })

  it('surfaces a final backend discrepancy even after the preview passed', async () => {
    render(<InTransitPageClient />)
    const request = await confirmArrival()
    const finalPhase = {
      ...IN_TRANSIT_PHASE,
      action_location_assessment: { ...ARRIVAL_PASS, proximity: 'separated' as const, separation_metres: 130 },
    }

    act(() => request.onOutcome({ kind: 'recorded', trip: null, addressedPhase: finalPhase }))

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Location warning recorded' }))
  })
})

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
    expect(openExceptionCards()).toHaveLength(1)
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

    expect(screen.queryByRole('region', { name: 'Open exceptions' })).not.toBeInTheDocument()
  })
})

describe('InTransitPageClient at accessibility text sizes', () => {
  beforeEach(() => {
    mockUseTrip.mockReturnValue({
      trip: { ...baseTrip, destination_precinct_id: String(mockPrecincts[1].id) }, isLoading: false, exceptions: [], ...tripStateFields,
    })
  })
  afterEach(() => { document.documentElement.style.fontSize = '' })

  it('test_moves_navigate_off_the_short_map_into_the_sheet', () => {
    document.documentElement.style.fontSize = '28px'

    render(<InTransitPageClient />)

    const navigate = screen.getByRole('link', { name: /navigate/i })
    expect(navigate.closest('section[aria-label="Your position"]')).toBeNull()
  })

  it('test_caps_the_sheet_and_lets_it_scroll_at_large_text', () => {
    document.documentElement.style.fontSize = '28px'

    render(<InTransitPageClient />)

    const sheet = screen.getByText('Heading to').closest('div.rounded-t-\\[28px\\]')
    expect(sheet).toHaveClass('overflow-y-auto')
    expect(sheet?.className).toMatch(/max-h-\[\d+dvh\]/)
  })

  it('test_leaves_the_sheet_uncapped_at_normal_sizes', () => {
    render(<InTransitPageClient />)

    const sheet = screen.getByText('Heading to').closest('div.rounded-t-\\[28px\\]')
    expect(sheet).not.toBeNull()
    expect(sheet).not.toHaveClass('overflow-y-auto')
  })

  it('test_keeps_navigate_on_the_map_at_normal_sizes', () => {
    render(<InTransitPageClient />)

    const navigate = screen.getByRole('link', { name: /navigate/i })
    expect(navigate.closest('section[aria-label="Your position"]')).not.toBeNull()
  })
})

describe('InTransitPageClient planned route ETA', () => {
  const LEG = {
    from_stop_sequence: IN_TRANSIT_PHASE.stop_sequence!,
    to_stop_sequence: IN_TRANSIT_PHASE.stop_sequence! + 1,
    distance_metres: 100_000,
    duration_seconds: 4000,
    coordinates: Array.from({ length: 11 }, (_, i) => [-26 - i / 10, 28] as [number, number]),
  }
  const ROUTE = {
    trip_id: 'trip-1', provider: 'openrouteservice', profile: 'driving-hgv',
    distance_metres: 100_000, duration_seconds: 4000, legs: [LEG], computed_at: '2026-10-14T08:00:00Z',
  }

  beforeEach(() => {
    mockUseTrip.mockReturnValue({
      trip: { ...baseTrip, planned_arrival_at: '2026-05-09T17:30:00Z', actual_departure_at: null },
      isLoading: false, exceptions: [], ...tripStateFields,
    })
    mockUseTripRoute.mockReturnValue(ROUTE)
  })

  it('test_shows_distance_left_and_draws_the_leg_when_on_the_planned_route', async () => {
    mockCapturePosition.mockResolvedValue({ lat: -26.5, lng: 28, accuracyM: 10 })

    render(<InTransitPageClient />)

    expect(await screen.findByText('50 km to go')).toBeInTheDocument()
    expect(screen.getByTestId('driver-map')).toHaveAttribute('data-route-points', '11')
    expect(screen.queryByText('Off planned route')).not.toBeInTheDocument()
  })

  it('test_falls_back_to_the_planned_arrival_when_off_the_route', async () => {
    mockCapturePosition.mockResolvedValue({ lat: -26.5, lng: 28.01, accuracyM: 10 })

    render(<InTransitPageClient />)

    expect(await screen.findByText('Off planned route')).toBeInTheDocument()
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument()
    expect(screen.queryByText(/to go$/)).not.toBeInTheDocument()
  })

  it('test_draws_no_line_and_keeps_the_planned_eta_without_a_route', async () => {
    mockUseTripRoute.mockReturnValue(null)
    mockCapturePosition.mockResolvedValue({ lat: -26.5, lng: 28, accuracyM: 10 })

    render(<InTransitPageClient />)

    await screen.findByText('-26.5,28')
    expect(screen.getByTestId('driver-map')).toHaveAttribute('data-route-points', '0')
    expect(screen.queryByText(/to go$/)).not.toBeInTheDocument()
  })
})
