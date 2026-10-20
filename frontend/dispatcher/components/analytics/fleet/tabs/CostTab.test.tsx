import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { TabQuery } from '@/lib/format/period'
import type { CostProfile, FleetCost, LaneCost } from '@shared/lib/types/cost-analytics'
import type { PrecinctId } from '@shared/lib/types/precinct'
import { FLEET_COPY } from '../copy'
import { CostTab } from './CostTab'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

// The rates card's Edit button checks the role; a plain dispatcher sees the read-only card.
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'dispatcher' } }),
}))

const mockedGet = vi.mocked(api.get)

const TODAY = '2026-09-16'
const QUERY: TabQuery = { start: '2026-08-31', end: TODAY, grain: 'week', grainAdjusted: false, disabledGrains: [] }
const PATH = '/api/v1/analytics/fleet/cost?start=2026-08-31&end=2026-09-16&grain=week'
// Intl's en-ZA groups thousands with a no-break space; \s matches it.
const rand = (text: string): RegExp => new RegExp(`^${text.replace(/ /g, '\\s')}$`)

const RATES: CostProfile = {
  diesel_price_per_litre: 33.29, litres_per_100km: 53, fuel_per_km: 17.6437, running_cost_per_km: 15.1,
  driver_cost_per_hour: 155, delay_cost_per_hour: 1100, fixed_cost_per_trip: 0, road_factor: 1.15,
  is_default: true, updated_at: null, updated_by_name: null,
}

function lane(origin: string | null, destination: string, overrides: Partial<LaneCost> = {}): LaneCost {
  return {
    origin_precinct_id: `${origin ?? 'none'}-id` as PrecinctId, origin_name: origin,
    destination_precinct_id: `${destination}-id` as PrecinctId, destination_name: destination,
    trip_count: 4, operating_total: 5100, operating_per_trip: 1275, delay_cost: 1200, value_exposed: 40000,
    distance_source: 'road', ...overrides,
  }
}

function makeCost(overrides: Partial<FleetCost> = {}): FleetCost {
  return {
    period: { start: QUERY.start ?? TODAY, end: TODAY, grain: 'week' },
    rates: RATES,
    operating: {
      fuel: 1000, running: 1500, driver: 2400, fixed: 200, total: 5100,
      trips_costed: 4, trips_not_costed: 1, distance_km: 500, legs_routed: 3, legs_estimated: 2,
    },
    delay: { cost: 1200, late_hours: 2, problem_trips: 4, late_problem_trips: 1, lateness_unknown: 1 },
    exposure: {
      under_review: 40000, reviewed: 0, total: 40000, trips: 2,
      consignments_without_value: 1, trips_without_consignments: 1,
    },
    buckets: [
      {
        start: '2026-08-31', is_partial: false, fuel: 600, running: 900, driver: 1900, fixed: 150,
        delay_cost: 1200, value_under_review: 40000, value_reviewed: 0,
      },
      {
        start: '2026-09-07', is_partial: false, fuel: 400, running: 600, driver: 500, fixed: 50,
        delay_cost: 0, value_under_review: 0, value_reviewed: 0,
      },
    ],
    lanes: [lane('O', 'D'), lane(null, 'X', { trip_count: 1, operating_total: 0, operating_per_trip: null, delay_cost: 0, value_exposed: 0 })],
    ...overrides,
  }
}

function emptyCost(): FleetCost {
  return makeCost({
    operating: {
      fuel: 0, running: 0, driver: 0, fixed: 0, total: 0,
      trips_costed: 0, trips_not_costed: 0, distance_km: 0, legs_routed: 0, legs_estimated: 0,
    },
    delay: { cost: 0, late_hours: 0, problem_trips: 0, late_problem_trips: 0, lateness_unknown: 0 },
    exposure: { under_review: 0, reviewed: 0, total: 0, trips: 0, consignments_without_value: 0, trips_without_consignments: 0 },
    buckets: [],
    lanes: [],
  })
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
  return render(<CostTab query={QUERY} allTimeStart="2026-06-20" today={TODAY} />)
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('CostTab', () => {
  it('asks once for the tab period', async () => {
    mockedGet.mockResolvedValue(makeCost())

    renderTab()

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(PATH))
    expect(mockedGet).toHaveBeenCalledTimes(1)
  })

  it('labels each headline figure as an estimate or from waybills', async () => {
    mockedGet.mockResolvedValue(makeCost())
    renderTab()

    const headline = await waitFor(() => card('Cost at a glance'))

    await within(headline).findByText(rand('R 5 100'))
    expect(within(headline).getAllByText('Estimate')).toHaveLength(2)
    expect(within(headline).getAllByText('From waybills')).toHaveLength(1)
    expect(within(headline).getByText(rand('R 1 200'))).toBeInTheDocument()
    expect(within(headline).getByText(rand('R 40 000'))).toBeInTheDocument()
  })

  it('shows the counts that are not in the figures, never hiding them as R0', async () => {
    mockedGet.mockResolvedValue(makeCost())
    renderTab()

    const headline = await waitFor(() => card('Cost at a glance'))

    expect(await within(headline).findByText('4 trips · 1 not costed (no departure or arrival time)')).toBeInTheDocument()
    expect(within(headline).getByText('2 of 5 legs measured as straight line × road factor')).toBeInTheDocument()
    expect(within(headline).getByText('2.0 h late over 1 problem trip')).toBeInTheDocument()
    expect(within(headline).getByText('1 without a planned or actual arrival')).toBeInTheDocument()
    expect(within(headline).getByText('1 consignment has no declared value')).toBeInTheDocument()
    expect(within(headline).getByText('1 trip has no waybills on record')).toBeInTheDocument()
  })

  it('leaves out the estimated-legs line when every leg was routed by road', async () => {
    const all = makeCost()
    mockedGet.mockResolvedValue(makeCost({ operating: { ...all.operating, legs_routed: 5, legs_estimated: 0 } }))
    renderTab()

    const headline = await waitFor(() => card('Cost at a glance'))

    await within(headline).findByText(rand('R 5 100'))
    expect(within(headline).queryByText(/legs measured as straight line/)).not.toBeInTheDocument()
  })

  it('names each card\'s source in its "i" popover', async () => {
    mockedGet.mockResolvedValue(makeCost())
    renderTab()
    const value = await waitFor(() => card('Cargo value exposed'))

    fireEvent.click(within(value).getByRole('button', { name: FLEET_COPY.chart.aboutChart('Cargo value exposed') }))

    expect(await screen.findByText(/From Parcel Perfect waybills: the declared value/)).toBeInTheDocument()
  })

  it('splits operating cost by part in the table twin', async () => {
    mockedGet.mockResolvedValue(makeCost())
    renderTab()

    const operating = await openTable('Operating cost over time')

    const [first] = rowsOf(operating)
    expect(first[0]).toBe('31 Aug – 6 Sep 2026')
    expect(first.slice(1)).toEqual(expect.arrayContaining([expect.stringMatching(rand('R 600')), expect.stringMatching(rand('R 3 550'))]))
  })

  it('lists every lane, with "—" where a lane had no costed trip', async () => {
    mockedGet.mockResolvedValue(makeCost())
    renderTab()

    const lanes = await openTable('Cost by lane')

    const [costly, uncosted] = rowsOf(lanes)
    expect(costly[0]).toBe('O → D')
    expect(costly[6]).toBe('By truck road route')
    expect(uncosted[0]).toBe('Unknown site → X')
    expect(uncosted[3]).toBe('—')
    expect(uncosted[6]).toBe('—')
  })

  it('shows the rates behind the estimates, with where each came from', async () => {
    mockedGet.mockResolvedValue(makeCost())
    renderTab()

    const rates = await waitFor(() => card('Cost rates'))

    expect(await within(rates).findByText(/R\s33,29 \/ L/)).toBeInTheDocument()
    expect(within(rates).getByText('53.0 L / 100 km')).toBeInTheDocument()
    expect(within(rates).getByText(/DMPR inland 50ppm/)).toBeInTheDocument()
    expect(within(rates).getByText('Starting rates from Bruce’s figures · All figures use today’s rates')).toBeInTheDocument()
  })

  it('names who last changed the rates once an admin has saved them', async () => {
    mockedGet.mockResolvedValue(makeCost({
      rates: { ...RATES, is_default: false, updated_at: '2026-10-15T08:30:00Z', updated_by_name: 'Tom Davis' },
    }))
    renderTab()

    const rates = await waitFor(() => card('Cost rates'))

    expect(await within(rates).findByText(/Last changed 15 Oct 2026, 10:30 SAST by Tom Davis/)).toBeInTheDocument()
  })

  it('shows the empty state for a period with no closed trips, and still the rates', async () => {
    mockedGet.mockResolvedValue(emptyCost())
    renderTab()

    const headline = await waitFor(() => card('Cost at a glance'))

    expect(await within(headline).findByText('No closed trips departed in this period.')).toBeInTheDocument()
    expect(within(card('Cost rates')).getByText(/Starting rates from Bruce’s figures/)).toBeInTheDocument()
  })

  it('offers a retry when the figures fail to load', async () => {
    mockedGet.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(makeCost())
    renderTab()

    const headline = await waitFor(() => card('Cost at a glance'))
    fireEvent.click(await within(headline).findByRole('button', { name: 'Retry' }))

    await within(card('Cost at a glance')).findByText(rand('R 5 100'))
    expect(mockedGet).toHaveBeenCalledTimes(2)
  })
})
