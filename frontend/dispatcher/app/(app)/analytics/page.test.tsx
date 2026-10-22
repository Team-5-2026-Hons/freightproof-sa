import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AnalyticsPage from './page'
import { api } from '@/lib/api/client'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { addDays, todaySast } from '@/lib/format/period'
import type { ChatAnswer, ChatStatus } from '@shared/lib/types/analytics-chat'
import type { FleetCost } from '@shared/lib/types/cost-analytics'
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
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message) }
  },
}))

const replace = vi.fn()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/analytics',
  useSearchParams: () => searchParams,
}))

const mockedGet = vi.mocked(api.get)
const mockedPost = vi.mocked(api.post)
const TILES_PATH = '/api/v1/analytics/fleet/tiles'
const CHAT_STATUS_PATH = '/api/v1/analytics/chat/status'
// Off unless a test switches it on, so the chat button is absent by default.
let chatStatus: ChatStatus = { enabled: false, spend: null }
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

function emptyCost(): FleetCost {
  return {
    period: period(),
    rates: {
      diesel_price_per_litre: 33.29, litres_per_100km: 53, fuel_per_km: 17.64, running_cost_per_km: 15.1,
      driver_cost_per_hour: 155, delay_cost_per_hour: 1100, fixed_cost_per_trip: 0, road_factor: 1.15,
      is_default: true, updated_at: null, updated_by_name: null,
    },
    operating: {
      fuel: 0, running: 0, driver: 0, fixed: 0, total: 0,
      trips_costed: 0, trips_not_costed: 0, distance_km: 0, legs_routed: 0, legs_estimated: 0,
    },
    delay: { cost: 0, late_hours: 0, problem_trips: 0, late_problem_trips: 0, lateness_unknown: 0 },
    exposure: { under_review: 0, reviewed: 0, total: 0, trips: 0, consignments_without_value: 0, trips_without_consignments: 0 },
    buckets: [],
    lanes: [],
  }
}

function emptyProblems(): FleetProblems {
  return { period: period(), per_trip: [], theft_signals: [], by_type: [], by_step: [], risky_times: [] }
}

/** Answer each endpoint with its own shape, the tiles from `tiles`. */
function serve(tiles: FleetTiles): void {
  const empty: Record<string, () => unknown> = {
    '/activity': emptyActivity, '/patterns': emptyPatterns, '/on-time': emptyOnTime, '/problems': emptyProblems, '/review': emptyReview, '/evidence': emptyEvidence, '/routes': emptyRoutes, '/incidents': emptyIncidents, '/cost': emptyCost,
  }
  mockedGet.mockImplementation((path: string) => {
    if (path === CHAT_STATUS_PATH) return Promise.resolve(chatStatus) as never
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
  mockedPost.mockReset()
  chatStatus = { enabled: false, spend: null }
  serve(makeTiles())
})

describe('Analytics page', () => {
  it('opens on the Activity tab with the tiles above it', async () => {
    renderPage()

    expect(await screen.findByText('Live trips')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Trips over time' })).toBeInTheDocument()
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
      CHAT_STATUS_PATH, '/api/v1/analytics/fleet/activity', '/api/v1/analytics/fleet/patterns', TILES_PATH,
    ]))
  })

  it('asks Routes & sites for its whole period, never with a grain', async () => {
    searchParams = new URLSearchParams('tab=routes')

    renderPage()
    await screen.findByText('Live trips')

    await waitFor(() => expect(requestedEndpoints()).toEqual([
      CHAT_STATUS_PATH, '/api/v1/analytics/fleet/incidents', '/api/v1/analytics/fleet/routes', TILES_PATH,
    ]))
    expect(mockedGet.mock.calls.map(([path]) => path).filter((path) => path.includes('grain='))).toEqual([])
  })

  it('opens the Cost tab and asks for its period with a grain', async () => {
    searchParams = new URLSearchParams('tab=cost')

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Cost at a glance' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Cost' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(requestedEndpoints()).toEqual([CHAT_STATUS_PATH, '/api/v1/analytics/fleet/cost', TILES_PATH]))
    expect(mockedGet.mock.calls.some(([path]) => path.startsWith('/api/v1/analytics/fleet/cost?') && path.includes('grain=week'))).toBe(true)
    expect(screen.getByRole('radiogroup', { name: 'View by' })).toBeInTheDocument()
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

  it('keeps the page notes behind the Information button until it is clicked', async () => {
    renderPage()
    await screen.findByText('Live trips')

    expect(screen.queryByText(/Trends count closed trips/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Information' }))

    const dialog = screen.getByRole('dialog', { name: 'About these figures' })
    expect(within(dialog).getByText(/Trends count closed trips/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Every figure comes from FreightProof/)).toBeInTheDocument()
    expect(within(dialog).getByText(/simulated and mock feeds until live credentials arrive/)).toBeInTheDocument()
  })

  it.each([
    ['cost', /Estimates use your cost rates below/],
    ['problems', /Dispatcher notes .* are not counted as problems/],
    ['review', /on open and closed trips alike/],
  ])('adds the %s tab\'s own note to the Information pop-up', async (tab, note) => {
    searchParams = new URLSearchParams(`tab=${tab}`)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Information' }))

    const dialog = screen.getByRole('dialog', { name: 'About these figures' })
    expect(within(dialog).getByText(note)).toBeInTheDocument()
    expect(within(dialog).getByText(/Trends count closed trips/)).toBeInTheDocument()
  })

  it('opens the incident map on Today when the address says so, and asks only for today', async () => {
    searchParams = new URLSearchParams('tab=routes&map=today')

    renderPage()

    await screen.findByRole('heading', { name: 'Incident map' })
    const today = todaySast()
    await waitFor(() => expect(
      mockedGet.mock.calls.map(([path]) => path).filter((path) => path.includes('/incidents?')),
    ).toEqual([`/api/v1/analytics/fleet/incidents?start=${today}&end=${today}`]))
    expect(screen.getByRole('radio', { name: 'Today' })).toHaveAttribute('aria-checked', 'true')
  })

  it('leaves the incident map on This period when the address does not ask for Today', async () => {
    searchParams = new URLSearchParams('tab=routes')

    renderPage()

    await screen.findByRole('heading', { name: 'Incident map' })
    expect(screen.getByRole('radio', { name: 'This period' })).toHaveAttribute('aria-checked', 'true')
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

  describe('Ask about these figures', () => {
    const ON = { enabled: true, spend: { spent_usd: 0.42, budget_usd: 20, available: true } }

    it("opens with the dispatcher assistant's question typed, not sent, and tidies the address (B30)", async () => {
      chatStatus = ON
      searchParams = new URLSearchParams({ ask: "What's our on-time rate this month?" })
      renderPage()

      const panel = await screen.findByRole('complementary', { name: 'Ask about these figures' })

      expect(within(panel).getByRole('textbox', { name: 'Your question' })).toHaveValue("What's our on-time rate this month?")
      expect(mockedPost).not.toHaveBeenCalled()
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/analytics?tab=activity', { scroll: false }))
    })

    it('ignores a carried question while the chat is switched off', async () => {
      searchParams = new URLSearchParams({ ask: 'Anything?' })
      renderPage()
      await screen.findByText('Live trips')

      await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(CHAT_STATUS_PATH))
      expect(screen.queryByRole('complementary', { name: 'Ask about these figures' })).not.toBeInTheDocument()
    })

    it('shows no chat button while the chat is switched off', async () => {
      renderPage()
      await screen.findByText('Live trips')

      await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(CHAT_STATUS_PATH))
      expect(screen.queryByRole('button', { name: 'Ask about these figures' })).not.toBeInTheDocument()
    })

    it('starts the button with a sparkle that screen readers skip, so its name stays the words', async () => {
      chatStatus = ON
      renderPage()

      const button = await screen.findByRole('button', { name: 'Ask about these figures' })

      const sparkle = within(button).getByTestId('chat-sparkle')
      expect(sparkle).toHaveAttribute('aria-hidden', 'true')
      expect(button.firstElementChild).toBe(sparkle)
    })

    it('opens the panel beside the tabs, which keep working, and closes it again', async () => {
      chatStatus = ON
      renderPage()

      fireEvent.click(await screen.findByRole('button', { name: 'Ask about these figures' }))

      const panel = screen.getByRole('complementary', { name: 'Ask about these figures' })
      expect(within(panel).getByText('AI spend this month: $0.42 of $20.00')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: 'On time' }))
      expect(replace).toHaveBeenCalledWith('/analytics?tab=on-time', { scroll: false })
      fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('complementary', { name: 'Ask about these figures' })).not.toBeInTheDocument()
    })

    it('re-reads the spend when the panel opens, so it never shows the page-load figure', async () => {
      chatStatus = ON
      renderPage()
      const button = await screen.findByRole('button', { name: 'Ask about these figures' })
      // Spent elsewhere since the page loaded (e.g. in a panel that has since been closed).
      chatStatus = { ...ON, spend: { ...ON.spend, spent_usd: 0.55 } }

      fireEvent.click(button)

      const panel = screen.getByRole('complementary', { name: 'Ask about these figures' })
      expect(await within(panel).findByText('AI spend this month: $0.55 of $20.00')).toBeInTheDocument()
    })

    it('opens a Based on line\'s tab with the answer\'s exact dates', async () => {
      chatStatus = ON
      const answer: ChatAnswer = {
        answer: 'On-time arrivals fell from 81% to 74%.',
        kind: 'answer',
        basis: [{
          tool: 'on_time', tab: 'on-time', label: 'On time', start: '2025-11-01', end: todaySast(),
          grain: 'month', closed_trip_count: 412,
        }],
        spend: ON.spend,
      }
      mockedPost.mockResolvedValue(answer)
      // Like the real router: replacing the address changes what useSearchParams reads next render.
      replace.mockImplementation((href: string) => { searchParams = new URLSearchParams(href.split('?')[1]) })
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Ask about these figures' }))
      fireEvent.click(screen.getByRole('button', { name: 'How did delays change over the past year?' }))

      fireEvent.click(await screen.findByRole('button', { name: 'Open On time with these dates' }))

      expect(replace).toHaveBeenCalledWith('/analytics?tab=on-time', { scroll: false })
      expect(await screen.findByRole('tab', { name: 'On time' })).toHaveAttribute('aria-selected', 'true')
      await waitFor(() => expect(mockedGet.mock.calls.some(([path]) =>
        path.startsWith('/api/v1/analytics/fleet/on-time?')
        && path.includes('start=2025-11-01') && path.includes('grain=month'),
      )).toBe(true))
    })
  })
})
