import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import InTransitPageClient from '../InTransitPageClient'
import { ROUTES } from '@/lib/constants/routes'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException, ExceptionId } from '@shared/lib/types/exception'

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()
const mockCapturePosition = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: mockCapturePosition, recordHere: vi.fn() }),
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

// The ledger shape this screen is actually shown in: in_transit resolved (the backend
// closes it the instant departure advances), unloading pending.
const DRIVING_PHASES = walk(SINGLE_LEG_PHASE_PLAN, 4)

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

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no fix. Suites that are not about the map then perform no state update at
  // all after mount, which keeps them free of act() noise from a background capture.
  mockCapturePosition.mockResolvedValue(null)
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
    mockUseTrip.mockReturnValue({ trip: baseTrip, isLoading: false, exceptions: [] })
  })

  it('offers panic, checkpoint, exception and arrival together, with panic always present', () => {
    render(<InTransitPageClient />)

    // Panic is the one control that must never be conditional or behind a scroll.
    expect(screen.getByRole('button', { name: 'Panic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /checkpoint/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log exception/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /arrive at destination/i })).toBeInTheDocument()
  })

  it('walks "Arrive at destination" to the arrival phase’s first step', () => {
    render(<InTransitPageClient />)

    fireEvent.click(screen.getByRole('button', { name: /arrive at destination/i }))

    // unloading is the current phase for the whole driving leg, so the generic
    // current-phase walk lands on its first step with no in_transit special case.
    expect(mockRouterPush).toHaveBeenCalledWith('/trip/phase/unloading/step/1-hand-waybill')
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
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, exceptions: [] })

    render(<InTransitPageClient />)

    // POPIA: no trip, no tracking.
    expect(mockCapturePosition).not.toHaveBeenCalled()
    expect(screen.getByText('Trip not found.')).toBeInTheDocument()
  })
})
