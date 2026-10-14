import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { ROUTES } from '@/lib/constants/routes'
import UpcomingTripsPage from '../page'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
vi.mock('@/components/layout/BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))

let mockActive: DriverTripSummary[] = []
let mockUpcoming: DriverTripSummary[] = []
vi.mock('@/lib/hooks/useGroupedTrips', () => ({
  useGroupedTrips: () => ({ active: mockActive, upcoming: mockUpcoming, past: [], isLoading: false, loadError: null, reload: vi.fn() }),
}))

function trip(ref: string, status: DriverTripSummary['status']): DriverTripSummary {
  const at = '2026-05-09T10:00:00Z'
  return {
    id: `id-${ref}` as DriverTripSummary['id'], trip_reference: ref, status, trip_type: 'loaded',
    origin_precinct_id: null, destination_precinct_id: null, origin_precinct_name: 'Durban Depot', destination_precinct_name: 'Cape Town Depot',
    planned_departure_at: at, actual_departure_at: null, planned_arrival_at: at, actual_arrival_at: null,
    needs_review_count: 0, created_at: at, updated_at: at,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockActive = []
  mockUpcoming = [trip('U1', 'created')]
})

describe('Upcoming trips (See all)', () => {
  it('test_lists_every_upcoming_trip', () => {
    render(<UpcomingTripsPage />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('test_opens_a_trip_by_id', () => {
    render(<UpcomingTripsPage />)

    fireEvent.click(screen.getByText('Durban Depot → Cape Town Depot'))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.tripDetailById('id-U1'))
  })

  it('test_reminds_the_driver_to_finish_the_current_trip_first', () => {
    mockActive = [trip('A', 'active')]

    render(<UpcomingTripsPage />)

    expect(screen.getByText(/Finish your current trip before starting the next one/)).toBeInTheDocument()
  })

  it('test_explains_an_empty_list', () => {
    mockUpcoming = []

    render(<UpcomingTripsPage />)

    expect(screen.getByText('No upcoming trips')).toBeInTheDocument()
  })
})
