import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { ROUTES } from '@/lib/constants/routes'
import PastTripsPage from '../page'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
vi.mock('@/components/layout/BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))

let mockPast: DriverTripSummary[] = []
vi.mock('@/lib/hooks/useGroupedTrips', () => ({
  useGroupedTrips: () => ({ active: [], upcoming: [], past: mockPast, isLoading: false, loadError: null, reload: vi.fn() }),
}))

function past(ref: string, at: string, origin: string): DriverTripSummary {
  return {
    id: `id-${ref}` as DriverTripSummary['id'], trip_reference: ref, status: 'closed', trip_type: 'loaded',
    origin_precinct_id: null, destination_precinct_id: null, origin_precinct_name: origin, destination_precinct_name: 'Cape Town Depot',
    planned_departure_at: at, actual_departure_at: at, planned_arrival_at: at, actual_arrival_at: at,
    needs_review_count: 0, created_at: at, updated_at: at,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPast = [past('A', '2026-05-20T08:00:00Z', 'Durban Depot'), past('B', '2026-04-10T08:00:00Z', 'Pretoria Depot')]
})

describe('Past trips (See all)', () => {
  it('test_lists_every_past_trip_under_month_headings', () => {
    render(<PastTripsPage />)

    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('test_filters_by_place', () => {
    render(<PastTripsPage />)

    fireEvent.click(screen.getByRole('button', { name: /Filter/ }))
    fireEvent.change(screen.getByLabelText(/Origin or destination/), { target: { value: 'durban' } })

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Durban Depot → Cape Town Depot')).toBeInTheDocument()
  })

  it('test_says_so_when_a_filter_matches_nothing', () => {
    render(<PastTripsPage />)

    fireEvent.click(screen.getByRole('button', { name: /Filter/ }))
    fireEvent.change(screen.getByLabelText(/Origin or destination/), { target: { value: 'kimberley' } })

    expect(screen.getByText('No matching trips')).toBeInTheDocument()
  })

  it('test_opens_a_trip_by_id', () => {
    render(<PastTripsPage />)

    fireEvent.click(screen.getByText('Durban Depot → Cape Town Depot'))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.tripDetailById('id-A'))
  })

  it('test_back_returns_to_trips_and_the_tab_bar_stays', () => {
    render(<PastTripsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to Trips' }))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.trips)
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })
})
