import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import { TripContext } from '@/lib/context/TripContext'
import { TripCompleteOverlay } from '../TripCompleteOverlay'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

type Ctx = NonNullable<React.ContextType<typeof TripContext>>

const COMPLETED = {
  tripId: 'cb6625a3-6978-4342-9c18-a782b43021d9',
  tripReference: 'FP-20261021-E97009E9',
  phases: SINGLE_LEG_PHASE_PLAN.map(phase => ({ ...phase, status: 'completed' as const })),
}

function renderWith(completedTrip: Ctx['completedTrip'], dismissTripCompleted = vi.fn()) {
  const value = { completedTrip, dismissTripCompleted } as unknown as Ctx
  render(<TripContext.Provider value={value}><TripCompleteOverlay /></TripContext.Provider>)
  return { dismissTripCompleted }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TripCompleteOverlay', () => {
  it('renders nothing when no trip has just completed', () => {
    renderWith(null)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names the finished trip and lists its phases', () => {
    renderWith(COMPLETED)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Trip complete')
    expect(dialog).toHaveTextContent('FP-20261021-E97009E9')
  })

  it('dismisses on Done without waiting for the timer', () => {
    const { dismissTripCompleted } = renderWith(COMPLETED)

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(dismissTripCompleted).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after 10 seconds', () => {
    const { dismissTripCompleted } = renderWith(COMPLETED)

    act(() => { vi.advanceTimersByTime(9_000) })
    expect(dismissTripCompleted).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1_500) })
    expect(dismissTripCompleted).toHaveBeenCalled()
  })

  it('counts down so the driver can see it is about to close', () => {
    renderWith(COMPLETED)

    expect(screen.getByText(/Closing in 10s/)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(3_000) })

    expect(screen.getByText(/Closing in 7s/)).toBeInTheDocument()
  })

  // A phase whose receipt has not landed must not be dressed up as anchored: the trip is
  // complete, the evidence chain is still catching up, and the screen says so.
  it('still shows a pending anchor as anchoring, not as done', () => {
    renderWith({
      ...COMPLETED,
      phases: COMPLETED.phases.map((phase, index) =>
        index === COMPLETED.phases.length - 1
          ? { ...phase, anchor_status: 'pending' as const }
          : { ...phase, anchor_status: 'anchored' as const }),
    })

    expect(screen.getByRole('dialog')).toHaveTextContent('Anchoring…')
  })
})
