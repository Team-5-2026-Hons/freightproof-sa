import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { TabQuery } from '@/lib/format/period'
import type { FleetOnTime, LatenessBand, PlanBand } from '@shared/lib/types/fleet-analytics'
import { OnTimeTab } from './OnTimeTab'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

const TODAY = '2026-09-16'
const QUERY: TabQuery = { start: '2026-08-31', end: TODAY, grain: 'week', grainAdjusted: false, disabledGrains: [] }
const PATH = '/api/v1/analytics/fleet/on-time?start=2026-08-31&end=2026-09-16&grain=week'
const WEEKS = ['2026-08-31', '2026-09-07']
const BANDS: LatenessBand[] = ['early', 'on_time', 'late_1_15', 'late_15_60', 'late_60_180', 'late_over_180']
const PLAN_BANDS: PlanBand[] = [
  'early_over_180', 'early_60_180', 'early_15_60', 'early_0_15', 'on_plan', 'over_0_15', 'over_15_60', 'over_60_180', 'over_over_180',
]

function makeOnTime(trips: boolean, onPlan: number = 2): FleetOnTime {
  const n = trips ? 1 : 0
  const spread: Partial<Record<PlanBand, number>> = trips
    ? { early_15_60: 10, early_0_15: 1, on_plan: onPlan, over_0_15: 3, over_15_60: 2 }
    : {}
  return {
    period: { start: QUERY.start ?? TODAY, end: TODAY, grain: 'week' },
    punctuality: WEEKS.map((week) => ({
      bucket_start: week, is_partial: false,
      departures_with_plan: 2 * n, on_time_departures: n, arrivals_with_plan: 3 * n, on_time_arrivals: 2 * n,
      on_time_departure_rate: trips ? 0.5 : null, on_time_arrival_rate: trips ? 2 / 3 : null,
    })),
    lateness: {
      departures: BANDS.map((band, index) => ({ band, trip_count: trips ? [1, 1, 1, 0, 1, 0][index] : 0 })),
      arrivals: BANDS.map((band, index) => ({ band, trip_count: trips ? [1, 2, 0, 1, 0, 1][index] : 0 })),
    },
    plan_spread: {
      bands: PLAN_BANDS.map((band) => ({ band, trip_count: spread[band] ?? 0 })),
      early_count: trips ? 11 : 0, over_count: trips ? 5 : 0, on_plan_count: trips ? onPlan : 0,
      median_early_minutes: trips ? 40 : null, median_over_minutes: trips ? 20 : null,
    },
  }
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('section')
  if (element === null) throw new Error(`no card titled ${title}`)
  return element
}

async function tableRows(title: string): Promise<(string | null)[][]> {
  const element = await waitFor(() => card(title))
  fireEvent.click(await within(element).findByRole('button', { name: 'Show table' }))
  // Body rows of every table on the card; header rows hold no cells.
  return within(element).getAllByRole('row')
    .map((row) => within(row).queryAllByRole('cell').map((cell) => cell.textContent))
    .filter((cells) => cells.length > 0)
}

function renderTab() {
  return render(<OnTimeTab query={QUERY} allTimeStart="2026-06-20" today={TODAY} />)
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('OnTimeTab', () => {
  it('asks once for the tab period and grain', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true))

    renderTab()

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))
    expect(mockedGet).toHaveBeenCalledWith(PATH)
  })

  it('says there is not enough data yet on every chart when nothing had a plan', async () => {
    mockedGet.mockResolvedValue(makeOnTime(false))

    renderTab()

    expect(await screen.findByText('No closed trip in this period had a planned departure or arrival.')).toBeInTheDocument()
    expect(screen.getByText('No departures with a planned time in this period.')).toBeInTheDocument()
    expect(screen.getByText('No closed trip in this period had a full plan to compare with.')).toBeInTheDocument()
  })

  it('has no step tiles: "Where the time goes" was removed (D24)', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true))

    renderTab()

    await waitFor(() => card('Plans vs reality'))
    expect(screen.queryByRole('heading', { name: 'Where the time goes' })).toBeNull()
  })

  it('shows on-time counts with their share in the punctuality table', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true))
    renderTab()

    const rows = await tableRows('On-time departures and arrivals')

    expect(rows[0]).toEqual(['31 Aug – 6 Sep 2026', '1 of 2 (50%)', '2 of 3 (67%)'])
  })

  it('explains faded weeks and the dock-or-road caption behind the info button', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true))
    renderTab()
    const punctuality = await waitFor(() => card('On-time departures and arrivals'))
    await within(punctuality).findByRole('button', { name: 'Show table' })
    expect(within(punctuality).queryByText(/^Faded:/)).toBeNull()

    fireEvent.click(within(punctuality).getByRole('button', { name: 'About this chart: On-time departures and arrivals' }))

    expect(within(punctuality).getByText(/a problem at the dock/)).toBeInTheDocument()
    expect(within(punctuality).getByText(/^Faded:/)).toBeInTheDocument()
  })

  it('switches the lateness bands to arrivals from the title row, without asking again', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true))
    renderTab()
    expect(await tableRows('How late is late')).toEqual([
      ['Early', '1'], ['On time', '1'], ['1–15 min late', '1'], ['15–60 min', '0'], ['1–3 h', '1'], ['3 h+', '0'],
    ])
    const lateness = card('How late is late')
    expect(within(lateness).queryByText('Show')).toBeNull()

    fireEvent.click(within(lateness).getByRole('radio', { name: 'Arrivals' }))

    const rows = within(lateness).getAllByRole('row').slice(1).map((row) =>
      within(row).getAllByRole('cell').map((cell) => cell.textContent))
    expect(rows.map((row) => row[1])).toEqual(['1', '2', '0', '1', '0', '1'])
    expect(mockedGet).toHaveBeenCalledTimes(1)
  })

  it('splits plans vs reality at a middle axis headed "Trips", with no summary on the card face', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true))
    renderTab()
    const spread = await waitFor(() => card('Plans vs reality'))
    await within(spread).findByRole('button', { name: 'Show table' })

    expect(within(spread).queryByText(/finished early \(typically/)).toBeNull()
    expect(within(spread).getByText('Trips')).toBeInTheDocument()
    expect(within(spread).getByText('On plan · 2 trips')).toBeInTheDocument()
    expect(within(spread).getByText('← Finished early')).toBeInTheDocument()
    expect(within(spread).getByText('Ran over →')).toBeInTheDocument()
  })

  it('says just "On plan" under the axis when no trip was exactly on plan', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true, 0))
    renderTab()
    const spread = await waitFor(() => card('Plans vs reality'))

    expect(await within(spread).findByText('On plan')).toBeInTheDocument()
  })

  it('lists every band, and the typical early and over times, in the table view', async () => {
    mockedGet.mockResolvedValue(makeOnTime(true))
    renderTab()

    const rows = await tableRows('Plans vs reality')

    expect(rows).toEqual([
      ['3 h+ early', '0'], ['1–3 h early', '0'], ['15–60 min early', '10'], ['0–15 min early', '1'], ['On plan', '2'],
      ['0–15 min over', '3'], ['15–60 min over', '2'], ['1–3 h over', '0'], ['3 h+ over', '0'],
    ])
    expect(within(card('Plans vs reality')).getByText('11 finished early (typically 40 min) · 5 ran over (typically 20 min)')).toBeInTheDocument()
  })
})
