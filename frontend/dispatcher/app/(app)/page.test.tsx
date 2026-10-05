import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ActiveTripsPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useTrips } from '@/lib/hooks/useTrips'
import type { UseTripsResult } from '@/lib/hooks/useTrips'
import type { TripSummary } from '@shared/lib/types/trip'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'admin_dispatcher' } }),
}))

const notify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/usePrecincts', () => ({ usePrecincts: vi.fn() }))
vi.mock('@/lib/hooks/useTrips', () => ({ useTrips: vi.fn() }))

const mockedUseTrips = vi.mocked(useTrips)
const mockedUsePrecincts = vi.mocked(usePrecincts)

// The list only reads the name; the rest of a full Driver is irrelevant to these tests.
const driverNamed = (name: string): TripSummary['driver'] => ({ full_name: name }) as TripSummary['driver']

function makeTrip(id: string, overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    id: id as TripSummary['id'],
    trip_reference: `FP-${id}`,
    pp_manifest: null,
    trip_type: 'standard',
    status: 'active',
    driver: driverNamed('Sipho Dlamini'),
    horse: { registration: 'GP 12-34 ZX' },
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'destination-1',
    needs_review_count: 0,
    created_at: '2026-10-01T08:00:00Z',
    current_phase: 'loading',
    current_stop: 0,
    phase_total: 7,
    phase_completed: 2,
    ...overrides,
  } as unknown as TripSummary
}

function tripsState(overrides: Partial<UseTripsResult> = {}): UseTripsResult {
  return { trips: [], isLoading: false, error: null, refetch: vi.fn(), ...overrides }
}

function renderPage() {
  return render(<ForensicModeProvider><ActiveTripsPage /></ForensicModeProvider>)
}

// Row order as the dispatcher sees it: the trip references in the order the rows appear.
const rowRefs = (): string[] =>
  screen.getAllByRole('row').slice(1).map(row => within(row).getByRole('link').getAttribute('aria-label')?.split(' · ')[1] ?? '')

beforeEach(() => {
  push.mockReset()
  notify.mockReset()
  mockedUseTrips.mockReset().mockReturnValue(tripsState())
  mockedUsePrecincts.mockReset().mockReturnValue({
    precincts: [
      { id: 'origin-1', name: 'Cape Town — Depot' },
      { id: 'destination-1', name: 'Johannesburg — Depot' },
    ] as never,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
})

describe('Dashboard active trips', () => {
  it('renders every column and links each row to its trip', () => {
    mockedUseTrips.mockReturnValue(tripsState({ trips: [makeTrip('t1')] }))

    renderPage()

    for (const name of ['Created', 'Trip ID', 'Driver / horse', 'Route', 'Progress', 'Status']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Sipho Dlamini · FP-t1' })).toHaveAttribute('href', '/trips/t1')
    // 08:00Z is 10:00 SAST.
    expect(screen.getByText('01 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('10:00 SAST')).toBeInTheDocument()
  })

  it('shows only active trips', () => {
    mockedUseTrips.mockReturnValue(tripsState({
      trips: [makeTrip('open'), makeTrip('done', { status: 'closed' }), makeTrip('gone', { status: 'cancelled' })],
    }))

    renderPage()

    expect(rowRefs()).toEqual(['FP-open'])
  })

  it('keeps the order the API sent until a header is clicked', () => {
    mockedUseTrips.mockReturnValue(tripsState({
      trips: [makeTrip('b', { driver: driverNamed('Zane') }), makeTrip('a', { driver: driverNamed('Aisha') })],
    }))

    renderPage()

    expect(rowRefs()).toEqual(['FP-b', 'FP-a'])
    for (const header of screen.getAllByRole('columnheader')) expect(header).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts by a header, reverses on a second click, and marks the sorted column', () => {
    mockedUseTrips.mockReturnValue(tripsState({
      trips: [makeTrip('b', { driver: driverNamed('Zane') }), makeTrip('a', { driver: driverNamed('Aisha') })],
    }))

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /driver/i }))

    expect(rowRefs()).toEqual(['FP-a', 'FP-b'])
    expect(screen.getByRole('columnheader', { name: /driver/i })).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(screen.getByRole('button', { name: /driver/i }))

    expect(rowRefs()).toEqual(['FP-b', 'FP-a'])
    expect(screen.getByRole('columnheader', { name: /driver/i })).toHaveAttribute('aria-sort', 'descending')
  })

  it('opens the date column newest first', () => {
    mockedUseTrips.mockReturnValue(tripsState({
      trips: [makeTrip('old', { created_at: '2026-09-01T08:00:00Z' }), makeTrip('new', { created_at: '2026-10-03T08:00:00Z' })],
    }))

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /created/i }))

    expect(rowRefs()).toEqual(['FP-new', 'FP-old'])
  })

  it('filters by trip reference or driver as you type', () => {
    mockedUseTrips.mockReturnValue(tripsState({
      trips: [makeTrip('a', { driver: driverNamed('Aisha') }), makeTrip('b', { driver: driverNamed('Zane') })],
    }))

    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/search trip id/i), { target: { value: 'zane' } })

    expect(rowRefs()).toEqual(['FP-b'])
  })

  it('shows placeholder rows on the first load and keeps rows during a live refetch', () => {
    mockedUseTrips.mockReturnValue(tripsState({ isLoading: true }))
    const { unmount } = renderPage()
    expect(screen.getByText('Loading active trips')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    unmount()

    mockedUseTrips.mockReturnValue(tripsState({ isLoading: true, trips: [makeTrip('t1')] }))
    renderPage()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false')
    expect(rowRefs()).toEqual(['FP-t1'])
  })

  it('shows the error with a retry, and toasts it', () => {
    const refetch = vi.fn()
    mockedUseTrips.mockReturnValue(tripsState({ error: 'Network unreachable', refetch }))

    renderPage()

    expect(screen.getByText('Failed to load trips')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to load trips' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('tells "no active trips" apart from "no results" for a search', () => {
    const { unmount } = renderPage()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No active trips')).toBeInTheDocument()
    unmount()

    mockedUseTrips.mockReturnValue(tripsState({ trips: [makeTrip('t1')] }))
    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/search trip id/i), { target: { value: 'nobody' } })

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('goes to the new-trip form from both New Trip buttons', () => {
    renderPage()

    for (const button of screen.getAllByRole('button', { name: 'New Trip' })) fireEvent.click(button)

    expect(push).toHaveBeenCalledTimes(2)
    expect(push).toHaveBeenCalledWith('/trips/new')
  })
})
