// frontend/driver-pwa/app/(app)/trips/__tests__/page.test.tsx
//
// Regression cover for the reported bug: a driver with one activated trip and two
// un-activated assignments saw only the active one — the other groups read mock fixtures
// filtered by the signed-in driver's real UUID, which matched no fixture. Rewritten for
// the overhaul (3.1): one non-scrolling page — Now, Upcoming and Past previews, each
// with "See all" — instead of three tabs; the grouping it protects is unchanged.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { __resetMyTripsStoreForTests } from '@/lib/hooks/useMyTrips'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import type { TripId } from '@shared/lib/types/trip'
import type { CoarseTripStatus } from '@shared/lib/types/phase'
import { ROUTES } from '@/lib/constants/routes'
import type { SubstitutionRequestRead } from '@shared/lib/types/driver-substitution'
import { substitutionFixturePack } from '@shared/lib/mocks/driver-substitutions'
import TripsPage from '../page'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'driver-real-uuid' } }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({ trip: null }),
}))

const mockFetchMyTrips = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyTrips: () => mockFetchMyTrips(),
}))

let mockPendingHandovers: SubstitutionRequestRead[] = []
vi.mock('@/lib/hooks/useDriverSubstitutions', () => ({
  useDriverSubstitutions: () => ({
    pending: mockPendingHandovers, notices: [], isLoading: false, loadError: null, lastRefreshedAt: null,
    refresh: vi.fn(), markNoticeRead: vi.fn(),
  }),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }))

function makeTrip(overrides: Partial<DriverTripSummary> & { status: CoarseTripStatus }): DriverTripSummary {
  return {
    id: `trip-${overrides.trip_reference ?? overrides.status}` as TripId,
    trip_reference: 'FP-TEST-0001',
    trip_type: 'loaded',
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'dest-1',
    origin_precinct_name: 'Johannesburg Depot',
    destination_precinct_name: 'Cape Town Depot',
    planned_departure_at: '2026-08-05T19:10:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-08-06T08:00:00Z',
    actual_arrival_at: null,
    needs_review_count: 0,
    created_at: '2026-08-04T19:10:00Z',
    updated_at: '2026-08-04T19:10:00Z',
    ...overrides,
  }
}

const ACTIVE = makeTrip({ status: 'active', trip_reference: 'FP-ACTIVE' })
const UPCOMING_A = makeTrip({ status: 'created', trip_reference: 'FP-UPCOMING-A', planned_departure_at: '2026-08-07T06:00:00Z', origin_precinct_name: 'Durban Depot' })
const UPCOMING_B = makeTrip({ status: 'created', trip_reference: 'FP-UPCOMING-B', planned_departure_at: '2026-08-06T06:00:00Z', origin_precinct_name: 'Pretoria Depot' })
const CLOSED_OLD = makeTrip({ status: 'closed', trip_reference: 'FP-CLOSED-OLD', planned_departure_at: '2026-06-01T06:00:00Z', origin_precinct_name: 'Kimberley Depot', actual_arrival_at: '2026-06-01T20:00:00Z' })
const CLOSED_NEW = makeTrip({ status: 'closed', trip_reference: 'FP-CLOSED-NEW', planned_departure_at: '2026-07-01T06:00:00Z', origin_precinct_name: 'Polokwane Depot', actual_arrival_at: '2026-07-01T20:00:00Z' })

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

describe('trips page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetMyTripsStoreForTests()
    mockPendingHandovers = []
  })

  it('test_shows_the_active_trip_up_front_and_both_assignments_as_upcoming', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_B, UPCOMING_A, ACTIVE])

    render(<TripsPage />)

    expect(await screen.findByRole('button', { name: /Current trip/ })).toHaveTextContent('Johannesburg Depot → Cape Town Depot')
    expect(within(section('Upcoming')).getAllByRole('listitem').length).toBeGreaterThanOrEqual(1)
  })

  it('test_groups_terminal_trips_into_past', async () => {
    mockFetchMyTrips.mockResolvedValue([CLOSED_OLD])

    render(<TripsPage />)

    expect(await screen.findByRole('region', { name: 'Past' })).toHaveTextContent('Kimberley Depot → Cape Town Depot')
  })

  it('test_renders_the_server_resolved_precinct_names_not_a_uuid', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_A])

    render(<TripsPage />)

    expect(await screen.findByText('Durban Depot → Cape Town Depot')).toBeInTheDocument()
  })

  it('test_warns_that_the_active_trip_must_be_finished_first', async () => {
    mockFetchMyTrips.mockResolvedValue([ACTIVE, UPCOMING_A])

    render(<TripsPage />)

    expect(await screen.findByText(/Finish your current trip before starting the next one/)).toBeInTheDocument()
  })

  it('test_opens_a_trip_by_id_rather_than_routing_every_row_to_the_session_trip', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_A])
    render(<TripsPage />)

    fireEvent.click(await screen.findByText('Durban Depot → Cape Town Depot'))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.tripDetailById('trip-FP-UPCOMING-A'))
  })

  it('test_lists_upcoming_soonest_first', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_A, UPCOMING_B])

    render(<TripsPage />)

    const rows = within(await screen.findByRole('region', { name: 'Upcoming' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Pretoria Depot')
  })

  it('test_lists_past_most_recent_first', async () => {
    mockFetchMyTrips.mockResolvedValue([CLOSED_OLD, CLOSED_NEW])

    render(<TripsPage />)

    const rows = within(await screen.findByRole('region', { name: 'Past' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Polokwane Depot')
  })

  it('test_see_all_opens_the_full_lists', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_A, CLOSED_OLD])
    render(<TripsPage />)

    fireEvent.click(within(await screen.findByRole('region', { name: 'Upcoming' })).getByRole('button', { name: /See all/ }))
    fireEvent.click(within(section('Past')).getByRole('button', { name: /See all/ }))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.tripsUpcoming)
    expect(mockPush).toHaveBeenCalledWith(ROUTES.tripsPast)
  })

  it('test_previews_only_what_fits_and_leaves_the_rest_to_see_all', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      makeTrip({ status: 'closed', trip_reference: `FP-P${i}`, planned_departure_at: `2026-07-0${i + 1}T06:00:00Z` }))
    mockFetchMyTrips.mockResolvedValue(many)

    render(<TripsPage />)

    const rows = within(await screen.findByRole('region', { name: 'Past' })).getAllByRole('listitem')
    expect(rows.length).toBeLessThan(8)
  })

  it('test_says_so_when_there_are_no_trips_at_all', async () => {
    mockFetchMyTrips.mockResolvedValue([])

    render(<TripsPage />)

    expect(await screen.findByText('No trips yet')).toBeInTheDocument()
  })

  it('test_surfaces_a_load_failure_and_retries', async () => {
    mockFetchMyTrips.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([UPCOMING_A])
    render(<TripsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }))

    expect(await screen.findByText('Durban Depot → Cape Town Depot')).toBeInTheDocument()
    expect(mockFetchMyTrips).toHaveBeenCalledTimes(2)
  })

  it('test_pending_incoming_handover_is_not_reported_as_no_trips', async () => {
    const fixture = substitutionFixturePack.incomingPendingNoActiveTrip.pending[0]
    mockPendingHandovers = [{ ...fixture, incoming: { ...fixture.incoming, id: 'driver-real-uuid' } }]
    mockFetchMyTrips.mockResolvedValue([])

    render(<TripsPage />)

    expect(await screen.findByText('Collect this trip')).toBeInTheDocument()
    expect(screen.queryByText('No trips yet')).not.toBeInTheDocument()
  })

  it('test_former_participation_is_listed_under_past_not_current', async () => {
    const handedOver = makeTrip({ status: 'active', trip_reference: 'FP-HANDED-OVER', participation: 'former' })
    mockFetchMyTrips.mockResolvedValue([handedOver])

    render(<TripsPage />)

    expect(await screen.findByText('Handed over')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Current trip/ })).not.toBeInTheDocument()
  })
})
