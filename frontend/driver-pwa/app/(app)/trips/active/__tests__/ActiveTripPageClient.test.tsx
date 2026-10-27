// frontend/driver-pwa/app/(app)/trips/active/__tests__/ActiveTripPageClient.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import ActiveTripPageClient from '../ActiveTripPageClient'
import { mockTrips, TRIP_0041_ID } from '@shared/lib/mocks/trips'

const mockUseTrip = vi.fn()
const mockPush = vi.fn()

vi.mock('@/components/layout/BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))
vi.mock('@/lib/hooks/useMyTrips', () => ({ useMyTrips: () => ({ trips: [], isLoading: false, loadError: null, reload: () => {} }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const inTransitTrip = mockTrips.find((t) => (t.id as string) === (TRIP_0041_ID as unknown as string))!

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

  it('renders the real trip and shows only the current phase, not the full list', () => {
    mockUseTrip.mockReturnValue({ trip: inTransitTrip, isLoading: false })

    render(<ActiveTripPageClient />)

    expect(screen.getByText(inTransitTrip.trip_reference)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Trip phases' })).not.toBeInTheDocument()
  })
})
