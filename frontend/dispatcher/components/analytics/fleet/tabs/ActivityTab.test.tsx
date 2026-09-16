import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { PeriodSelection, TabQuery } from '@/lib/format/period'
import type {
  CancelledTrip,
  FleetActivity,
  FleetPatterns,
  PatternBar,
  PatternSet,
} from '@shared/lib/types/fleet-analytics'
import { ActivityTab } from './ActivityTab'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

// A Wednesday; the last week bucket (w/c 14 Sep) is still running.
const TODAY = '2026-09-16'
const QUERY: TabQuery = { start: '2026-08-31', end: TODAY, grain: 'week', grainAdjusted: false, disabledGrains: [] }
const ALL_TIME: PeriodSelection = { preset: 'all_time' }
const ACTIVITY_PATH = '/api/v1/analytics/fleet/activity?start=2026-08-31&end=2026-09-16&grain=week'
const PATTERNS_PATH = '/api/v1/analytics/fleet/patterns?end=2026-09-16'
const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14']

function makeActivity(loaded: number[], empty: number[], cancelled: number[], ended: number[], trips: CancelledTrip[] = []): FleetActivity {
  return {
    period: { start: QUERY.start ?? TODAY, end: TODAY, grain: 'week' },
    trips: WEEKS.map((week, index) => ({
      bucket_start: week, is_partial: index === WEEKS.length - 1, loaded_count: loaded[index], empty_count: empty[index],
    })),
    cancellations: WEEKS.map((week, index) => ({
      bucket_start: week, is_partial: index === WEEKS.length - 1, cancelled_count: cancelled[index],
      ended_count: ended[index], cancelled_rate: ended[index] === 0 ? null : cancelled[index] / ended[index],
    })),
    cancelled_trips: trips,
  }
}

function bars(count: number, first: number, events: Record<number, number>, days: number): PatternBar[] {
  return Array.from({ length: count }, (_, index) => {
    const key = first + index
    const eventCount = events[key] ?? 0
    return { key, event_count: eventCount, day_count: days, average_per_day: days === 0 ? null : eventCount / days }
  })
}

function patternSet(hourEvents: Record<number, number>): PatternSet {
  return {
    hour_of_day: bars(24, 0, hourEvents, 14),
    weekday: bars(7, 0, {}, 2),
    day_of_month: bars(31, 1, {}, 1),
    month_of_year: bars(12, 1, {}, 14),
  }
}

function makePatterns(departures: Record<number, number>, arrivals: Record<number, number>): FleetPatterns {
  return {
    period: { start: '2026-09-03', end: TODAY, grain: null },
    departures: patternSet(departures),
    arrivals: patternSet(arrivals),
  }
}

function serve(activity: FleetActivity, patterns: FleetPatterns): void {
  mockedGet.mockImplementation((path: string) =>
    Promise.resolve(path.includes('/patterns') ? patterns : activity) as never)
}

function renderTab(query: TabQuery = QUERY, allTimeStart: string | null = '2026-06-20') {
  return render(
    <ActivityTab
      query={query} allTimeStart={allTimeStart} today={TODAY}
      patternPeriod={ALL_TIME} onPatternPeriodChange={vi.fn()}
    />,
  )
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('section')
  if (element === null) throw new Error(`no card titled ${title}`)
  return element
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('ActivityTab', () => {
  it('requests the trends for the tab period and the patterns for their own period', async () => {
    serve(makeActivity([1, 2, 3], [0, 0, 1], [0, 0, 0], [1, 2, 4]), makePatterns({ 7: 3 }, { 12: 3 }))

    renderTab()

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2))
    expect(mockedGet.mock.calls.map(([path]) => path).sort()).toEqual([ACTIVITY_PATH, PATTERNS_PATH].sort())
  })

  it('waits to ask for an All-time trend until it knows where All time starts', async () => {
    serve(makeActivity([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]), makePatterns({}, {}))

    renderTab({ ...QUERY, start: null }, null)

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))
    expect(mockedGet).toHaveBeenCalledWith(PATTERNS_PATH)
  })

  it('shows placeholders while the first answers load', () => {
    mockedGet.mockReturnValue(new Promise(() => {}))

    renderTab()

    expect(card('Trips over time').lastElementChild).toHaveAttribute('aria-busy', 'true')
  })

  it('says there is not enough data yet when nothing happened', async () => {
    serve(makeActivity([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]), makePatterns({}, {}))

    renderTab()

    expect(await screen.findByText('No closed trips departed in this period.')).toBeInTheDocument()
    expect(screen.getByText('No trips ended in this period.')).toBeInTheDocument()
    expect(screen.getAllByText('No departures in this period.')).toHaveLength(4)
  })

  it('warns when the trips rest on very few', async () => {
    serve(makeActivity([1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 1, 1]), makePatterns({ 7: 3 }, {}))

    renderTab()

    expect(await within(await waitFor(() => card('Trips over time'))).findByText('Based on only 3 trips — read with care')).toBeInTheDocument()
  })

  it('keeps the question and trip count behind the info button', async () => {
    serve(makeActivity([10, 12, 4], [1, 0, 2], [0, 1, 0], [11, 12, 6]), makePatterns({ 7: 3 }, {}))
    renderTab()
    const trips = await waitFor(() => card('Trips over time'))
    await within(trips).findByRole('button', { name: 'Show table' })
    expect(within(trips).queryByText('Are we getting busier?')).toBeNull()

    fireEvent.click(within(trips).getByRole('button', { name: 'About this chart: Trips over time' }))

    expect(within(trips).getByText('Are we getting busier?')).toBeInTheDocument()
    expect(within(trips).getByText('Closed trips, by the day they first departed · 29 trips')).toBeInTheDocument()
  })

  it('shows every bucket in the trips table, with the running week marked "so far"', async () => {
    serve(makeActivity([10, 12, 4], [1, 0, 2], [0, 1, 0], [11, 12, 6]), makePatterns({ 7: 3 }, {}))
    renderTab()
    const trips = await waitFor(() => card('Trips over time'))

    fireEvent.click(await within(trips).findByRole('button', { name: 'Show table' }))

    const rows = within(trips).getAllByRole('row').slice(1).map((row) =>
      within(row).getAllByRole('cell').map((cell) => cell.textContent))
    expect(rows).toEqual([
      ['31 Aug – 6 Sep 2026', '10', '1', '11'],
      ['7–13 Sep 2026', '12', '0', '12'],
      ['14–20 Sep 2026 (so far)', '4', '2', '6'],
    ])
  })

  it('lists cancelled trips with links to them in the cancellations table', async () => {
    const trip: CancelledTrip = {
      trip_id: 'trip-9' as CancelledTrip['trip_id'], trip_reference: 'FP-2026-0042', cancelled_at: '2026-09-08T09:30:00Z',
    }
    serve(makeActivity([10, 12, 4], [1, 0, 2], [0, 1, 0], [11, 12, 6], [trip]), makePatterns({ 7: 3 }, {}))
    renderTab()
    const cancellations = await waitFor(() => card('Cancellations over time'))
    fireEvent.click(await within(cancellations).findByRole('button', { name: 'About this chart: Cancellations over time' }))
    expect(within(cancellations).getByText('1 cancelled out of 29 trips that ended, by the day they ended')).toBeInTheDocument()

    fireEvent.click(await within(cancellations).findByRole('button', { name: 'Show table' }))

    expect(within(cancellations).getByRole('link', { name: 'FP-2026-0042' })).toHaveAttribute('href', '/trips/trip-9')
    expect(within(cancellations).getByText('8 Sep 2026')).toBeInTheDocument()
    expect(within(cancellations).getByText('8%')).toBeInTheDocument()
  })

  it('switches patterns between departures and arrivals without asking again', async () => {
    serve(makeActivity([1, 2, 3], [0, 0, 1], [0, 0, 0], [1, 2, 4]), makePatterns({ 7: 3 }, { 12: 5 }))
    renderTab()
    const byHour = await waitFor(() => card('By hour of day'))
    await within(byHour).findByRole('button', { name: 'Show table' })
    const requests = mockedGet.mock.calls.length

    fireEvent.click(screen.getByRole('radio', { name: 'Arrivals' }))
    fireEvent.click(within(byHour).getByRole('button', { name: 'About this chart: By hour of day' }))

    expect(within(byHour).getByText('Average arrivals a day')).toBeInTheDocument()
    expect(within(byHour).getByText('Based on 5 arrivals')).toBeInTheDocument()
    expect(mockedGet.mock.calls.length).toBe(requests)
  })

  it('notes that months need a full year when the pattern period is shorter', async () => {
    serve(makeActivity([1, 2, 3], [0, 0, 1], [0, 0, 0], [1, 2, 4]), makePatterns({ 7: 3 }, {}))

    renderTab()

    expect(await screen.findByText('Needs a full year of history to compare months fairly.')).toBeInTheDocument()
  })

  it('shows each pattern bar in its table, in clock order', async () => {
    serve(makeActivity([1, 2, 3], [0, 0, 1], [0, 0, 0], [1, 2, 4]), makePatterns({ 7: 7 }, {}))
    renderTab()
    const byHour = await waitFor(() => card('By hour of day'))

    fireEvent.click(await within(byHour).findByRole('button', { name: 'Show table' }))

    const seventh = within(byHour).getByText('07:00–08:00').closest('tr')
    if (seventh === null) throw new Error('no 07:00 row')
    expect(within(seventh).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['07:00–08:00', '7', '14', '0.50'])
    expect(within(byHour).getAllByRole('row')[1]).toHaveTextContent('00:00–01:00')
  })
})
