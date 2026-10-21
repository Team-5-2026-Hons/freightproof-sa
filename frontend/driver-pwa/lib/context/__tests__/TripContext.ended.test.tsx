// frontend/driver-pwa/lib/context/__tests__/TripContext.ended.test.tsx
//
// A trip dispatch ended (cancelled, or stopped from an incident) must be said, not silently
// dropped: the context remembers it as endedByDispatch, whether the driver had it pinned or the
// server's own pick simply stopped returning it. A trip that completed normally is not "ended
// by dispatch", and a failed check says nothing.
import { useContext } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { AuthState } from '@/lib/types/user'
import { AuthContext } from '../AuthContext'
import { TripContext, TripProvider } from '../TripContext'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const mockFetchMyActiveTrip = vi.fn()
const mockFetchMyTrip = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyActiveTrip: (...args: unknown[]) => mockFetchMyActiveTrip(...args),
  fetchMyTrip: (...args: unknown[]) => mockFetchMyTrip(...args),
}))

const SELECTED_TRIP_KEY = 'fp.selectedTripId'
const ENDED_AT = '2026-10-20T11:42:00Z'

const driver = mockDrivers[0]
const authValue: AuthState = { user: driver, isLoading: false, requestOtp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }

const [workingTrip] = mockTrips.filter((t) => !['closed', 'cancelled'].includes(t.status))
if (workingTrip === undefined) throw new Error('Fixture drift: need an open mock trip')
const cancelled = { ...workingTrip, status: 'cancelled' as const, closed_at: ENDED_AT }
const completed = { ...workingTrip, status: 'closed' as const, closed_at: ENDED_AT }

let ctx: React.ContextType<typeof TripContext> = null

function Probe() {
  ctx = useContext(TripContext)
  return (
    <div>
      <p data-testid="trip">{ctx?.trip?.id ?? 'none'}</p>
      <p data-testid="ended">{ctx?.endedByDispatch?.tripId ?? 'none'}</p>
    </div>
  )
}

function renderProvider() {
  return render(
    <AuthContext.Provider value={authValue}>
      <TripProvider>
        <Probe />
      </TripProvider>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  ctx = null
})

describe('TripContext ended-by-dispatch handling', () => {
  it('ends_by_dispatch_pinned_trip_is_said_not_silently_dropped', async () => {
    // Arrange
    window.sessionStorage.setItem(SELECTED_TRIP_KEY, String(workingTrip.id))
    mockFetchMyTrip.mockResolvedValue(cancelled)
    mockFetchMyActiveTrip.mockResolvedValue(null)

    // Act
    renderProvider()

    // Assert
    await waitFor(() => expect(screen.getByTestId('ended')).toHaveTextContent(String(workingTrip.id)))
    expect(screen.getByTestId('trip')).toHaveTextContent('none')
    expect(ctx?.endedByDispatch).toEqual({ tripId: String(workingTrip.id), tripReference: workingTrip.trip_reference, endedAt: ENDED_AT })
    expect(window.sessionStorage.getItem(SELECTED_TRIP_KEY)).toBeNull()
  })

  it('ends_by_dispatch_when_the_server_pick_stops_returning_the_working_trip', async () => {
    // Arrange
    mockFetchMyActiveTrip.mockResolvedValueOnce(workingTrip).mockResolvedValue(null)
    mockFetchMyTrip.mockResolvedValue(cancelled)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(workingTrip.id)))

    // Act
    await act(async () => { await ctx?.refreshQuietly() })

    // Assert
    expect(mockFetchMyTrip).toHaveBeenCalledWith(String(workingTrip.id))
    expect(screen.getByTestId('ended')).toHaveTextContent(String(workingTrip.id))
  })

  it('a_trip_that_completed_normally_is_not_ended_by_dispatch', async () => {
    // Arrange
    mockFetchMyActiveTrip.mockResolvedValueOnce(workingTrip).mockResolvedValue(null)
    mockFetchMyTrip.mockResolvedValue(completed)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(workingTrip.id)))

    // Act
    await act(async () => { await ctx?.refreshQuietly() })

    // Assert
    expect(screen.getByTestId('ended')).toHaveTextContent('none')
  })

  it('a_failed_check_says_nothing_and_does_not_ask_again', async () => {
    // Arrange
    mockFetchMyActiveTrip.mockResolvedValueOnce(workingTrip).mockResolvedValue(null)
    mockFetchMyTrip.mockRejectedValue(new Error('offline'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(workingTrip.id)))

    // Act
    await act(async () => { await ctx?.refreshQuietly() })
    await act(async () => { await ctx?.refreshQuietly() })

    // Assert
    expect(screen.getByTestId('ended')).toHaveTextContent('none')
    expect(mockFetchMyTrip).toHaveBeenCalledTimes(1)
  })

  it('dismissing clears the notice', async () => {
    // Arrange
    window.sessionStorage.setItem(SELECTED_TRIP_KEY, String(workingTrip.id))
    mockFetchMyTrip.mockResolvedValue(cancelled)
    mockFetchMyActiveTrip.mockResolvedValue(null)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('ended')).toHaveTextContent(String(workingTrip.id)))

    // Act
    act(() => ctx?.dismissEndedByDispatch())

    // Assert
    expect(screen.getByTestId('ended')).toHaveTextContent('none')
  })
})
