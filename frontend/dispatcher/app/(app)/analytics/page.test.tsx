import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AnalyticsPage from './page'
import { api } from '@/lib/api/client'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { addDays, todaySast } from '@/lib/format/period'
import type {
  FleetActivity,
  FleetEvidence,
  FleetIncidents,
  FleetOnTime,
  FleetPatterns,
  FleetProblems,
  FleetReview,
  FleetRoutes,
  FleetTiles,
  PatternSet,
} from '@shared/lib/types/fleet-analytics'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const replace = vi.fn()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/analytics',
  useSearchParams: () => searchParams,
}))

const mockedGet = vi.mocked(api.get)
const TILES_PATH = '/api/v1/analytics/fleet/tiles'
const NO_BANDS = { expired: 0, within_30_days: 0, within_90_days: 0, within_180_days: 0, no_date: 0 }

function makeTiles(overrides: Partial<FleetTiles> = {}): FleetTiles {
  return {
    live_trips: 7,
    critical_waiting: { count: 0, oldest_created_at: null },
    licence_expiry: { drivers: NO_BANDS, vehicle_discs: NO_BANDS },
    unused_vehicles: { window_days: 30, vehicles: [] },
    all_time_start: addDays(todaySast(), -60),
    ...overrides,
  }
}

const NO_PATTERNS: PatternSet = { hour_of_day: [], weekday: [], day_of_month: [], month_of_year: [] }

function emptyActivity(): FleetActivity {
  return { period: { start: todaySast(), end: todaySast(), grain: 'week' }, trips: [], cancellations: [], cancelled_trips: [] }
}

function emptyPatterns(): FleetPatterns {
  return { period: { start: todaySast(), end: todaySast(), grain: null }, departures: NO_PATTERNS, arrivals: NO_PATTERNS }
}

function period(): FleetOnTime['period'] {
  return { start: todaySast(), end: todaySast(), grain: 'week' }
}

function emptyOnTime(): FleetOnTime {
  return {
    period: period(), punctuality: [], lateness: { departures: [], arrivals: [] },
    plan_spread: { bands: [], early_count: 0, over_count: 0, on_plan_count: 0, median_early_minutes: null, median_over_minutes: null },
  }
}

function emptyReview(): FleetReview {
  return { period: period(), waiting_by_age: [], queue: [], time_to_review: [], outcomes: [] }
}

function emptyEvidence(): FleetEvidence {
  return {
    period: period(), tracker: [], overrides: [], receiver_signoff: [],
    signoff_flags: { same_phone_count: 0, rejected_attempt_count: 0 },
  }
}

function emptyRoutes(): FleetRoutes {
  return { period: period(), sites: [], lanes: [] }
}

function emptyIncidents(): FleetIncidents {
  return { period: period(), pins: [], unlocated_count: 0 }
}

function emptyProblems(): FleetProblems {
  return { period: period(), per_trip: [], theft_signals: [], by_type: [], by_step: [], risky_times: [] }
}

/** Answer each endpoint with its own shape, the tiles from `tiles`. */
function serve(tiles: FleetTiles): void {
  const empty: Record<string, () => unknown> = {
    '/activity': emptyActivity, '/patterns': emptyPatterns, '/on-time': emptyOnTime, '/problems': emptyProblems, '/review': emptyReview, '/evidence': emptyEvidence, '/routes': emptyRoutes, '/incidents': emptyIncidents,
  }
  mockedGet.mockImplementation((path: string) => {
    const match = Object.keys(empty).find((endpoint) => path.includes(`${endpoint}?`))
    return Promise.resolve(match === undefined ? tiles : empty[match]()) as never
  })
}

function requestedEndpoints(): string[] {
  return [...new Set(mockedGet.mock.calls.map(([path]) => path.split('?')[0]))].sort()
}

function renderPage() {
  return render(
    <ForensicModeProvider>
      <AnalyticsPage />
    </ForensicModeProvider>,
  )
}

beforeEach(() => {
  replace.mockReset()
  searchParams = new URLSearchParams()
  mockedGet.mockReset()
  serve(makeTiles())
})

describe('Analytics page', () => {
  it('opens on the Activity tab with the tiles above it', async () => {
    renderPage()

    expect(await screen.findByText('Live trips')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Trips over time' })).toBeInTheDocument()
    expect(screen.getByText(/Trends count closed trips/)).toBeInTheDocument()
  })

  it('opens the tab named in the address', async () => {
    searchParams = new URLSearchParams('tab=evidence')

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Tracker agreement' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true')
  })

  it('falls back to Activity for an unknown tab', async () => {
    searchParams = new URLSearchParams('tab=nonsense')

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Trips over time' })).toBeInTheDocument()
  })

  it('puts the chosen tab in the address', async () => {
    renderPage()
    await screen.findByText('Live trips')

    fireEvent.click(screen.getByRole('tab', { name: 'On time' }))

    expect(replace).toHaveBeenCalledWith('/analytics?tab=on-time', { scroll: false })
  })

  it('requests only the open tab\'s endpoints', async () => {
    renderPage()
    await screen.findByText('Live trips')

    await waitFor(() => expect(requestedEndpoints()).toEqual([
      '/api/v1/analytics/fleet/activity', '/api/v1/analytics/fleet/patterns', TILES_PATH,
    ]))
  })

  it('asks Routes & sites for its whole period, never with a grain', async () => {
    searchParams = new URLSearchParams('tab=routes')

    renderPage()
    await screen.findByText('Live trips')

    await waitFor(() => expect(requestedEndpoints()).toEqual([
      '/api/v1/analytics/fleet/incidents', '/api/v1/analytics/fleet/routes', TILES_PATH,
    ]))
    expect(mockedGet.mock.calls.map(([path]) => path).filter((path) => path.includes('grain='))).toEqual([])
  })

  it('shows View by on trend tabs but not on Routes & sites', async () => {
    const { unmount } = renderPage()
    expect(await screen.findByRole('radiogroup', { name: 'View by' })).toBeInTheDocument()
    unmount()
    searchParams = new URLSearchParams('tab=routes')

    renderPage()

    await screen.findByRole('heading', { name: 'Busiest sites' })
    expect(screen.queryByRole('radiogroup', { name: 'View by' })).toBeNull()
    expect(screen.getByLabelText('Period')).toBeInTheDocument()
  })

  it('keeps each tab\'s own period when switching tabs', async () => {
    const { rerender } = renderPage()
    await screen.findByText('Live trips')
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'last_26_weeks' } })

    searchParams = new URLSearchParams('tab=problems')
    rerender(<ForensicModeProvider><AnalyticsPage /></ForensicModeProvider>)
    expect(screen.getByLabelText('Period')).toHaveValue('last_12_weeks')

    searchParams = new URLSearchParams('tab=activity')
    rerender(<ForensicModeProvider><AnalyticsPage /></ForensicModeProvider>)
    expect(screen.getByLabelText('Period')).toHaveValue('last_26_weeks')
  })

  it('offers only the periods that suit the View by, and swaps one that no longer does', async () => {
    renderPage()
    await screen.findByText('Live trips')

    fireEvent.click(screen.getByRole('radio', { name: 'Year' }))

    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('all_time'))
    // Only the tab's own Period list: Activity's busy-patterns card has a period list of its own.
    expect(within(screen.getByLabelText('Period')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['This year', 'Last 3 years', 'All time', 'Custom range…'])
  })

  it('comes back to the tab, View by and period a report was opened from, then tidies the address', async () => {
    searchParams = new URLSearchParams('tab=problems&grain=month&period=last_6_months')

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Problems over time' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Period')).toHaveValue('last_6_months')
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics?tab=problems', { scroll: false }))
  })

  it('gives Routes & sites the general list when it is returned to with a View by period', async () => {
    searchParams = new URLSearchParams('tab=routes&grain=week&period=last_26_weeks')

    renderPage()

    await screen.findByRole('heading', { name: 'Busiest sites' })
    expect(screen.getByLabelText('Period')).toHaveValue('last_12_weeks')
  })

  it('switches All time to months, and says so, once the history is longer than a year', async () => {
    serve(makeTiles({ all_time_start: addDays(todaySast(), -800) }))
    renderPage()
    await screen.findByText('Live trips')

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'all_time' } })

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Showing by month: too many weeks for this period.')
  })
})
