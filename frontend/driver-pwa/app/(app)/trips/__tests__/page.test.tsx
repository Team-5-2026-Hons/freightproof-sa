// frontend/driver-pwa/app/(app)/trips/__tests__/page.test.tsx
//
// Regression cover for the reported bug: a driver with one activated trip and two
// un-activated assignments saw Active=1, Upcoming=0, Past=0 — the Upcoming and Past tabs
// read mock fixtures filtered by the signed-in driver's real UUID, which matched no
// fixture, so real trips could never appear there however many existed.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import type { TripId } from '@shared/lib/types/trip'
import type { CoarseTripStatus } from '@shared/lib/types/phase'
import TripsPage from '../page'

// Real-data mode: demo mode short-circuits to fixtures and would prove nothing here.
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'driver-real-uuid' } }),
}))

const mockFetchMyTrips = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyTrips: () => mockFetchMyTrips(),
}))

// @radix-ui/react-tabs activates a trigger on mousedown (for perceived responsiveness),
// not on click — fireEvent.click alone never reaches Radix's selection handler, so fire
// the fuller pointer sequence a real click produces. Mirrors components/ui/__tests__/Tabs.test.tsx.
function switchToTab(name: RegExp): void {
  const trigger = screen.getByRole('tab', { name })
  fireEvent.mouseDown(trigger)
  fireEvent.click(trigger)
}

function makeTrip(overrides: Partial<DriverTripSummary> & { status: CoarseTripStatus }): DriverTripSummary {
  return {
    id: `trip-${overrides.trip_reference ?? overrides.status}` as TripId,
    trip_reference: 'FP-TEST-0001',
    order_number: 'ORD-0001',
    trip_type: 'loaded',
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'dest-1',
    origin_precinct_name: 'Johannesburg Depot',
    destination_precinct_name: 'Cape Town Depot',
    planned_departure_at: '2026-08-05T19:10:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-08-06T08:00:00Z',
    actual_arrival_at: null,
    open_exception_count: 0,
    created_at: '2026-08-04T19:10:00Z',
    updated_at: '2026-08-04T19:10:00Z',
    ...overrides,
  }
}

// The exact shape reported: one activated trip, two assignments not yet started.
const ACTIVE = makeTrip({ status: 'active', trip_reference: 'FP-ACTIVE' })
const UPCOMING_A = makeTrip({ status: 'created', trip_reference: 'FP-UPCOMING-A' })
const UPCOMING_B = makeTrip({ status: 'created', trip_reference: 'FP-UPCOMING-B' })
const CLOSED = makeTrip({
  status: 'closed', trip_reference: 'FP-CLOSED', actual_arrival_at: '2026-07-01T10:00:00Z',
})

describe('trips list page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts an activated trip and two un-activated assignments as Active 1 / Upcoming 2', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_B, UPCOMING_A, ACTIVE])

    render(<TripsPage />)

    // Tab labels carry their own count, so asserting on the tab proves the grouping.
    expect(await screen.findByRole('tab', { name: /Active 1/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Upcoming 2/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Past 0/i })).toBeInTheDocument()
  })

  it('shows only the activated trip on the Active tab', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_B, UPCOMING_A, ACTIVE])

    render(<TripsPage />)

    expect(await screen.findByText('FP-ACTIVE')).toBeInTheDocument()
    // A 'created' trip is an assignment, not an active trip — it must not appear here.
    expect(screen.queryByText('FP-UPCOMING-A')).not.toBeInTheDocument()
    expect(screen.queryByText('FP-UPCOMING-B')).not.toBeInTheDocument()
  })

  it('lists both un-activated assignments on the Upcoming tab', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_B, UPCOMING_A, ACTIVE])
    render(<TripsPage />)
    await screen.findByText('FP-ACTIVE')

    switchToTab(/Upcoming/i)

    expect(screen.getByText('FP-UPCOMING-A')).toBeInTheDocument()
    expect(screen.getByText('FP-UPCOMING-B')).toBeInTheDocument()
    expect(screen.queryByText('FP-ACTIVE')).not.toBeInTheDocument()
  })

  it('groups terminal trips into Past', async () => {
    mockFetchMyTrips.mockResolvedValue([ACTIVE, CLOSED])
    render(<TripsPage />)
    await screen.findByText('FP-ACTIVE')

    switchToTab(/Past/i)

    expect(screen.getByText('FP-CLOSED')).toBeInTheDocument()
  })

  it('renders the server-resolved precinct names, not a truncated UUID', async () => {
    mockFetchMyTrips.mockResolvedValue([ACTIVE])

    render(<TripsPage />)

    expect(
      await screen.findByText('Johannesburg Depot → Cape Town Depot'),
    ).toBeInTheDocument()
  })

  it('warns on the Upcoming tab that an active trip must be finished first', async () => {
    mockFetchMyTrips.mockResolvedValue([ACTIVE, UPCOMING_A])
    render(<TripsPage />)
    await screen.findByText('FP-ACTIVE')

    switchToTab(/Upcoming/i)

    expect(screen.getByText(/Finish your active trip/i)).toBeInTheDocument()
  })

  it('opens a trip by id rather than routing every row to the session trip', async () => {
    mockFetchMyTrips.mockResolvedValue([UPCOMING_A])
    render(<TripsPage />)
    await screen.findByRole('tab', { name: /Upcoming 1/i })
    switchToTab(/Upcoming/i)

    fireEvent.click(screen.getByText('FP-UPCOMING-A'))

    expect(mockPush).toHaveBeenCalledWith(`/trips/detail?id=${UPCOMING_A.id}`)
  })

  it('lists upcoming trips soonest departure first, whatever order the server sent', async () => {
    const aug5 = makeTrip({
      status: 'created', trip_reference: 'FP-AUG-05', planned_departure_at: '2026-08-05T08:00:00Z',
    })
    const aug6 = makeTrip({
      status: 'created', trip_reference: 'FP-AUG-06', planned_departure_at: '2026-08-06T08:00:00Z',
    })
    // Server order is the wrong way round — the page must not preserve it.
    mockFetchMyTrips.mockResolvedValue([aug6, aug5])
    render(<TripsPage />)
    await screen.findByRole('tab', { name: /Upcoming 2/i })
    switchToTab(/Upcoming/i)

    const rendered = screen.getAllByText(/^FP-AUG-/).map((el) => el.textContent)

    expect(rendered).toEqual(['FP-AUG-05', 'FP-AUG-06'])
  })

  it('lists past trips most recent departure first', async () => {
    const july = makeTrip({
      status: 'closed', trip_reference: 'FP-JULY', planned_departure_at: '2026-07-01T08:00:00Z',
    })
    const august = makeTrip({
      status: 'closed', trip_reference: 'FP-AUGUST', planned_departure_at: '2026-08-01T08:00:00Z',
    })
    mockFetchMyTrips.mockResolvedValue([july, august])
    render(<TripsPage />)
    await screen.findByRole('tab', { name: /Past 2/i })
    switchToTab(/Past/i)

    const rendered = screen.getAllByText(/^FP-(JULY|AUGUST)$/).map((el) => el.textContent)

    expect(rendered).toEqual(['FP-AUGUST', 'FP-JULY'])
  })

  it('surfaces a load failure instead of claiming there are no trips', async () => {
    mockFetchMyTrips.mockRejectedValue(new Error('offline'))
    // Expected console.error from the page's own catch — silenced so it doesn't look
    // like a test failure in the output.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<TripsPage />)

    await waitFor(() => {
      expect(screen.getByText(/Could not load your trips/i)).toBeInTheDocument()
    })
    expect(screen.queryByText('No active trip')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('retries the fetch when the driver taps Try again', async () => {
    mockFetchMyTrips.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([ACTIVE])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<TripsPage />)
    await screen.findByText(/Could not load your trips/i)

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }))

    expect(await screen.findByText('FP-ACTIVE')).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
