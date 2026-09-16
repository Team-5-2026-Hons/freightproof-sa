import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { TabQuery } from '@/lib/format/period'
import type { FleetProblems } from '@shared/lib/types/fleet-analytics'
import { FLEET_COPY } from '../copy'
import { ProblemsTab } from './ProblemsTab'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

const TODAY = '2026-09-16'
const QUERY: TabQuery = { start: '2026-08-31', end: TODAY, grain: 'week', grainAdjusted: false, disabledGrains: [] }
const PATH = '/api/v1/analytics/fleet/problems?start=2026-08-31&end=2026-09-16&grain=week'
const THEFT_TYPES = ['seal_mismatch', 'seal_broken_in_transit', 'parcel_count_mismatch', 'waybill_count_mismatch', 'panic_button', 'receiver_id_mismatch']

function makeProblems(trips: number): FleetProblems {
  const theft = Object.fromEntries(THEFT_TYPES.map((type) => [type, type === 'panic_button' ? 1 : 0]))
  return {
    period: { start: QUERY.start ?? TODAY, end: TODAY, grain: 'week' },
    per_trip: [
      {
        bucket_start: '2026-08-31', is_partial: false, trip_count: trips, info_count: 0, warning_count: 1, critical_count: 1,
        warning_per_100: trips === 0 ? null : 100 / trips, critical_per_100: trips === 0 ? null : 100 / trips,
      },
    ],
    theft_signals: [{ bucket_start: '2026-08-31', is_partial: false, total_count: 1, by_type: theft }],
    by_type: [
      { exception_type: 'mechanical', source: 'driver', count: 1 },
      { exception_type: 'seal_mismatch', source: 'system', count: 2 },
      { exception_type: 'seal_mismatch', source: 'driver', count: 1 },
    ],
    by_step: [
      { step: 'trip_creation', count: 0 }, { step: 'activation', count: 0 }, { step: 'loading', count: 1 },
      { step: 'departure', count: 0 }, { step: 'in_transit', count: 2 }, { step: 'unloading', count: 0 },
      { step: 'confirmation', count: 0 }, { step: 'unlinked', count: 1 },
    ],
    risky_times: [
      { block: 'night', driving_minutes: 0, driving_share: 0, road_problem_count: 1, road_problem_share: 0.5 },
      { block: 'morning', driving_minutes: 300, driving_share: 0.75, road_problem_count: 1, road_problem_share: 0.5 },
      { block: 'afternoon', driving_minutes: 100, driving_share: 0.25, road_problem_count: 0, road_problem_share: 0 },
      { block: 'evening', driving_minutes: 0, driving_share: 0, road_problem_count: 0, road_problem_share: 0 },
    ],
  }
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('section')
  if (element === null) throw new Error(`no card titled ${title}`)
  return element
}

async function openTable(title: string): Promise<HTMLElement> {
  const element = await waitFor(() => card(title))
  fireEvent.click(await within(element).findByRole('button', { name: 'Show table' }))
  return element
}

function rowsOf(element: HTMLElement): (string | null)[][] {
  return within(element).getAllByRole('row').slice(1).map((row) =>
    within(row).getAllByRole('cell').map((cell) => cell.textContent))
}

function renderTab() {
  return render(<ProblemsTab query={QUERY} allTimeStart="2026-06-20" today={TODAY} />)
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('ProblemsTab', () => {
  it('asks once for the tab period and says dispatcher notes are not counted', async () => {
    mockedGet.mockResolvedValue(makeProblems(8))

    renderTab()

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(PATH))
    expect(screen.getByText(/Dispatcher notes .* are not counted as problems/)).toBeInTheDocument()
  })

  it('counts problems over time, with the rate per trip beside the trips it rests on', async () => {
    mockedGet.mockResolvedValue(makeProblems(8))
    renderTab()

    const perTrip = await openTable('Problems over time')

    expect(rowsOf(perTrip)[0]).toEqual(['31 Aug – 6 Sep 2026', '8', '1', '1', '0.3'])
    fireEvent.click(within(perTrip).getByRole('button', { name: 'Show chart' }))
    expect(within(perTrip).getByText('Warning')).toBeInTheDocument()
    expect(within(perTrip).getByText('Critical')).toBeInTheDocument()
  })

  it('words the tooltip as counts, never as "per 100"', () => {
    expect(FLEET_COPY.problems.perTrip.tooltip(8, 2, '4')).toBe('8 problems across 2 trips (4 per trip)')
    expect(FLEET_COPY.problems.perTrip.tooltip(1, 1, '1')).toBe('1 problem across 1 trip (1 per trip)')
  })

  it('gives each theft sign its own column in the table', async () => {
    mockedGet.mockResolvedValue(makeProblems(8))
    renderTab()

    const theft = await openTable('Theft warning signs')

    const headers = within(theft).getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual(['Week', 'Seal Mismatch', 'Seal Broken In Transit', 'Parcel Count Mismatch', 'Waybill Count Mismatch', 'Panic Button', 'Receiver ID Mismatch', 'Theft signs'])
    expect(rowsOf(theft)[0]).toEqual(['31 Aug – 6 Sep 2026', '0', '0', '0', '0', '1', '0', '1'])
  })

  it('lists the most common problems biggest first, split by who raised them', async () => {
    mockedGet.mockResolvedValue(makeProblems(8))
    renderTab()

    const byType = await openTable('Most common problems')

    expect(rowsOf(byType)).toEqual([
      ['Seal Mismatch', '2', '1', '0', '3'],
      ['Mechanical', '0', '1', '0', '1'],
    ])
  })

  it('shows trip creation and activation only when something happened there', async () => {
    mockedGet.mockResolvedValue(makeProblems(8))
    renderTab()

    const byStep = await openTable('Where in the trip')

    expect(rowsOf(byStep).map((row) => row[0])).toEqual([
      'Loading', 'Waiting to leave', 'Driving', 'Unloading', 'Sign-off', 'Not linked to a step',
    ])
  })

  it('keeps the risky-times caption in the popover and the signal caveat with its table', async () => {
    mockedGet.mockResolvedValue(makeProblems(8))
    renderTab()
    const risky = await openTable('Risky times of day')

    expect(within(risky).getByText(/may arrive later than it happened/)).toBeInTheDocument()
    expect(rowsOf(risky)[1]).toEqual(['Morning 06–12', '5 h', '75%', '1', '50%'])
    fireEvent.click(within(risky).getByRole('button', { name: 'About this chart: Risky times of day' }))
    expect(within(risky).getByText(/that time of day is riskier/)).toBeInTheDocument()
  })

  it('warns when the problems rest on very few trips', async () => {
    mockedGet.mockResolvedValue(makeProblems(3))
    renderTab()

    const perTrip = await waitFor(() => card('Problems over time'))

    expect(await within(perTrip).findByText('Based on only 3 trips — read with care')).toBeInTheDocument()
  })

  it('says there is not enough data yet with no closed trips', async () => {
    const empty: FleetProblems = { ...makeProblems(0), by_type: [], by_step: [], risky_times: [] }
    mockedGet.mockResolvedValue(empty)

    renderTab()

    expect((await screen.findAllByText('No closed trips departed in this period.')).length).toBe(2)
    expect(screen.getAllByText('No problems were recorded on closed trips in this period.')).toHaveLength(2)
  })
})
