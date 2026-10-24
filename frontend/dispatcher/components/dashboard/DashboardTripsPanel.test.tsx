import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardTripsPanel } from './DashboardTripsPanel'
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

// Flagged: unreviewed exceptions, so it qualifies for the dashboard's Needs action panel.
const flagged = (id: string, overrides: Partial<TripSummary> = {}): TripSummary =>
  makeTrip(id, { needs_review_count: 1, attention: { critical: 0, warning: 1, info: 0, claimed: 0 }, ...overrides })

function tripsState(overrides: Partial<UseTripsResult> = {}): UseTripsResult {
  return { trips: [], isLoading: false, error: null, refetch: vi.fn(), ...overrides }
}

// Row order as the dispatcher sees it: the trip references in the order the rows appear.
const rowRefs = (): string[] =>
  screen.getAllByRole('row').slice(1).map(row => within(row).getByRole('link').getAttribute('aria-label')?.split(' · ')[1] ?? '')

beforeEach(() => {
  notify.mockReset()
  mockedUseTrips.mockReset().mockReturnValue(tripsState())
  mockedUsePrecincts.mockReset().mockReturnValue({
    precincts: [
      { id: 'origin-1', name: 'Cape Town · Depot' },
      { id: 'destination-1', name: 'Johannesburg · Depot' },
    ] as never,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
})

function renderPanel() {
  return render(<ForensicModeProvider><DashboardTripsPanel /></ForensicModeProvider>)
}

describe('DashboardTripsPanel', () => {
  it('lists every active trip, flagged ones first and most urgent first, then the rest', () => {
    mockedUseTrips.mockReturnValue(tripsState({
      trips: [
        makeTrip('quiet'),
        flagged('warn'),
        flagged('crit', { attention: { critical: 1, warning: 0, info: 0, claimed: 0 } }),
        flagged('closed', { status: 'closed' }),
      ],
    }))

    renderPanel()

    expect(rowRefs()).toEqual(['FP-crit', 'FP-warn', 'FP-quiet'])
    expect(screen.getByText('3 active · 2 need action')).toBeInTheDocument()
  })

  it('shows at most 8 trips but counts them all', () => {
    mockedUseTrips.mockReturnValue(tripsState({
      trips: Array.from({ length: 11 }, (_, i) => flagged(`t${i}`)),
    }))

    renderPanel()

    expect(rowRefs()).toHaveLength(8)
    expect(screen.getByText('11 active · 11 need action')).toBeInTheDocument()
  })

  it('has no search box and no sortable headers', () => {
    mockedUseTrips.mockReturnValue(tripsState({ trips: [flagged('a')] }))

    renderPanel()

    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /driver/i })).toBeNull()
  })

  it('links View all to the Active Trips page', () => {
    mockedUseTrips.mockReturnValue(tripsState({ trips: [flagged('a')] }))

    renderPanel()

    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', '/trips')
  })

  it('says there are no active trips when there are none', () => {
    renderPanel()

    expect(screen.getByText('No active trips')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the error with a retry and no count, and toasts it', () => {
    const refetch = vi.fn()
    mockedUseTrips.mockReturnValue(tripsState({ error: 'Network unreachable', refetch }))

    renderPanel()

    expect(screen.getByText('Failed to load trips')).toBeInTheDocument()
    expect(screen.queryByText(/need action/)).toBeNull()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to load trips' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows placeholder rows on the first load', () => {
    mockedUseTrips.mockReturnValue(tripsState({ isLoading: true }))

    renderPanel()

    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
  })
})
