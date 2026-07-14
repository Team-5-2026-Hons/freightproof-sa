import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import InTransitPageClient from '../InTransitPageClient'
import type { TripException, ExceptionId } from '@shared/lib/types/exception'

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
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
    handshake_event_id: null,
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

// The hub must render the CONTEXT exceptions list (mock/fetched + session-logged),
// not the trip.exceptions fetch snapshot — otherwise a just-submitted exception
// silently vanishes from the driver's view.
const baseTrip = {
  id: 'trip-1',
  trip_reference: 'TRP-2026-0041',
  planned_arrival_at: null,
  status: 'in_transit',
  // Deliberately stale: only ONE exception here. The context list below has three.
  exceptions: [makeException({ description: 'Stale snapshot exception' })],
}

describe('InTransitPageClient exceptions list (5b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
    vi.clearAllMocks()
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
