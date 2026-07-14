// frontend/driver-pwa/app/(app)/trips/active/__tests__/ActiveTripPageClient.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ActiveTripPageClient from '../ActiveTripPageClient'
import { mockTrips, TRIP_0041_ID } from '@shared/lib/mocks/trips'

const mockUseTrip = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

const inTransitTrip = mockTrips.find((t) => (t.id as string) === (TRIP_0041_ID as unknown as string))!

// Fix 5: this page is now a thin wrapper over the shared TripDetailView — these tests
// only need to prove it sources the real session-derived trip (via useTrip) and passes
// showAllHandshakes=false (the live active-trip screen's distinguishing behavior).
// TripDetailView's own rendering logic is covered by its own test file.
describe('trips/active ActiveTripPageClient (live trip)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a spinner while the trip is loading', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: true })

    render(<ActiveTripPageClient />)

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
  })

  it('shows "Trip not found" once loading finishes with no trip', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false })

    render(<ActiveTripPageClient />)

    expect(screen.getByText('Trip not found.')).toBeInTheDocument()
  })

  it('renders the real trip and shows only the current handshake, not the full list', () => {
    mockUseTrip.mockReturnValue({ trip: inTransitTrip, isLoading: false })

    render(<ActiveTripPageClient />)

    expect(screen.getByRole('heading', { name: inTransitTrip.trip_reference })).toBeInTheDocument()
    expect(screen.queryByText('Handshakes')).not.toBeInTheDocument()
  })
})
