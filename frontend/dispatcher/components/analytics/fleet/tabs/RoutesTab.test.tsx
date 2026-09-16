import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { TabQuery } from '@/lib/format/period'
import type { DurationStats } from '@shared/lib/types/analytics'
import type { FleetIncidents, FleetRoutes, IncidentPin, LaneRisk, SiteActivity } from '@shared/lib/types/fleet-analytics'
import { RoutesTab } from './RoutesTab'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

// Leaflet has no place in jsdom; the map's own pure parts are tested in IncidentMap.test.tsx.
// The stand-in writes which pin the table chose, so a row click can be checked without a map.
vi.mock('../map/IncidentMap', () => ({
  INCIDENT_MAP_HEIGHT: 360,
  IncidentMap: ({ pins, selection }: { pins: readonly unknown[]; selection?: { id: string } | null }) => (
    <div data-testid="incident-map">{pins.length} pins{selection ? ` · chosen ${selection.id}` : ''}</div>
  ),
}))

const mockedGet = vi.mocked(api.get)

const TODAY = '2026-09-16'
const QUERY: TabQuery = { start: '2026-08-31', end: TODAY, grain: 'week', grainAdjusted: false, disabledGrains: [] }
const RETURN_TO = '/analytics?tab=routes&grain=week&period=last_12_weeks'

function renderTab() {
  return render(<RoutesTab query={QUERY} returnTo={RETURN_TO} />)
}

function stats(values: number[]): DurationStats {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    sample_count: values.length, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    minimum: sorted[0] ?? null, maximum: sorted.at(-1) ?? null,
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, p90: sorted.at(-1) ?? null,
  }
}

function site(index: number, pickups: number, deliveries: number): SiteActivity {
  return { precinct_id: `site-${index}` as SiteActivity['precinct_id'], precinct_name: `Depot ${index}`, pickup_count: pickups, delivery_count: deliveries }
}

function lane(origin: string, destination: string, trips: number, minutes: number[], problems: number): LaneRisk {
  return {
    origin_precinct_id: origin as LaneRisk['origin_precinct_id'], origin_name: origin,
    destination_precinct_id: destination as LaneRisk['destination_precinct_id'], destination_name: destination,
    trip_count: trips, driving_minutes: stats(minutes), problem_count: problems,
    problems_per_trip: trips === 0 ? null : problems / trips,
  }
}

function makeRoutes(): FleetRoutes {
  return {
    period: { start: QUERY.start ?? TODAY, end: TODAY, grain: null },
    sites: Array.from({ length: 12 }, (_, index) => site(index + 1, 12 - index, 1)),
    lanes: [
      lane('Durban DC', 'Joburg DC', 6, [300, 360, 420], 3),
      lane('Joburg DC', 'Cape Town DC', 2, [900], 2),
    ],
  }
}

function pin(id: string, severity: IncidentPin['severity']): IncidentPin {
  return {
    exception_id: id as IncidentPin['exception_id'], trip_id: `trip-${id}` as IncidentPin['trip_id'],
    trip_reference: `FP-${id}`, exception_type: 'panic_button', severity,
    created_at: '2026-09-08T07:00:00Z', lat: -26.2, lng: 28.0,
  }
}

function makeIncidents(pins: IncidentPin[], unlocated: number): FleetIncidents {
  return { period: { start: QUERY.start ?? TODAY, end: TODAY, grain: null }, pins, unlocated_count: unlocated }
}

function serve(routes: FleetRoutes, incidents: FleetIncidents): void {
  mockedGet.mockImplementation((path: string) => Promise.resolve(path.includes('/incidents?') ? incidents : routes) as never)
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

beforeEach(() => {
  mockedGet.mockReset()
})

describe('RoutesTab', () => {
  it('asks for routes and incidents over the period, with no grain', async () => {
    serve(makeRoutes(), makeIncidents([], 0))

    renderTab()

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2))
    expect(mockedGet.mock.calls.map(([path]) => path).sort()).toEqual([
      '/api/v1/analytics/fleet/incidents?start=2026-08-31&end=2026-09-16',
      '/api/v1/analytics/fleet/routes?start=2026-08-31&end=2026-09-16',
    ])
  })

  it('puts busiest sites and lane risk first, then driving time and the map', async () => {
    serve(makeRoutes(), makeIncidents([pin('a', 'critical')], 0))

    renderTab()

    await waitFor(() => card('Incident map'))
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Busiest sites', 'Lane risk', 'Driving time per lane', 'Incident map',
    ])
  })

  it('draws the ten busiest sites and opens the rest on request; the table has them all', async () => {
    serve(makeRoutes(), makeIncidents([], 0))
    renderTab()
    const sites = await waitFor(() => card('Busiest sites'))

    fireEvent.click(await within(sites).findByRole('button', { name: 'Show all 12' }))

    expect(within(sites).getByRole('button', { name: 'Show top 10' })).toBeInTheDocument()
    fireEvent.click(within(sites).getByRole('button', { name: 'Show table' }))
    expect(rowsOf(sites)).toHaveLength(12)
    expect(rowsOf(sites)[0]).toEqual(['Depot 1', '12', '1', '13'])
  })

  it('shows typical and bad-day driving time per lane and flags lanes on too few trips', async () => {
    serve(makeRoutes(), makeIncidents([], 0))
    renderTab()

    const times = await openTable('Driving time per lane')

    expect(rowsOf(times)).toEqual([
      ['Durban DC → Joburg DC', '6', '6 h', '7 h'],
      ['Joburg DC → Cape Town DC', '2', '15 h', '15 h'],
    ])
    fireEvent.click(within(times).getByRole('button', { name: 'Show chart' }))
    expect(within(times).getByText(/fewer than 5 trips/)).toBeInTheDocument()
  })

  it('names the busy-and-risky corner on the chart and explains the average lines in the popover', async () => {
    serve(makeRoutes(), makeIncidents([], 0))
    renderTab()
    const risk = await waitFor(() => card('Lane risk'))

    expect(await within(risk).findByText('Busy and risky')).toBeInTheDocument()
    fireEvent.click(within(risk).getByRole('button', { name: 'About this chart: Lane risk' }))
    expect(within(risk).getByText(/two faint lines mark the average lane.*Top-right = busy and risky\./)).toBeInTheDocument()
  })

  it('lists lanes riskiest first', async () => {
    serve(makeRoutes(), makeIncidents([], 0))
    renderTab()

    const risk = await openTable('Lane risk')

    expect(rowsOf(risk)).toEqual([
      ['Joburg DC → Cape Town DC', '2', '2', '1.00'],
      ['Durban DC → Joburg DC', '6', '3', '0.50'],
    ])
  })

  it('lists pins under the map, with links, the unlocated count and nothing about the driver', async () => {
    serve(makeRoutes(), makeIncidents([pin('a', 'critical'), pin('b', 'warning')], 3))
    renderTab()
    const map = await waitFor(() => card('Incident map'))

    expect(await within(map).findByTestId('incident-map')).toHaveTextContent('2 pins')
    expect(within(map).getByText('3 reports in this period had no location.')).toBeInTheDocument()
    expect(within(map).getByRole('link', { name: 'FP-a' })).toHaveAttribute('href', '/trips/trip-a')
    expect(within(map).queryByText(/driver/i)).toBeNull()
  })

  it('opens a report with a way back to this tab as it was', async () => {
    serve(makeRoutes(), makeIncidents([pin('a', 'critical')], 0))
    renderTab()
    const map = await waitFor(() => card('Incident map'))

    const open = await within(map).findByRole('link', { name: 'Open' })

    expect(open).toHaveAttribute('href', `/exceptions/a?returnTo=${encodeURIComponent(RETURN_TO)}`)
  })

  it('shows ten pins at a time and loads the rest ten more at a time', async () => {
    const pins = Array.from({ length: 23 }, (_, index) => pin(`p${index + 1}`, 'warning'))
    serve(makeRoutes(), makeIncidents(pins, 0))
    renderTab()
    const map = await waitFor(() => card('Incident map'))

    expect(await within(map).findByText(/Showing 10 of 23/)).toBeInTheDocument()
    expect(rowsOf(map)).toHaveLength(10)
    fireEvent.click(within(map).getByRole('button', { name: 'Load 10 more' }))
    expect(rowsOf(map)).toHaveLength(20)
    fireEvent.click(within(map).getByRole('button', { name: 'Load 3 more' }))

    expect(rowsOf(map)).toHaveLength(23)
    expect(within(map).queryByRole('button', { name: /^Load/ })).toBeNull()
  })

  it('finds a pin on the map when its row is clicked', async () => {
    serve(makeRoutes(), makeIncidents([pin('a', 'critical'), pin('b', 'warning')], 0))
    renderTab()
    const map = await waitFor(() => card('Incident map'))
    const [, , secondRow] = await within(map).findAllByRole('row')

    fireEvent.click(secondRow)

    expect(within(map).getByTestId('incident-map')).toHaveTextContent('chosen b')
  })

  it('explains an empty map and still counts reports with no location', async () => {
    serve(makeRoutes(), makeIncidents([], 2))

    renderTab()

    expect(await screen.findByText(/No reports with a location in this period\..*2 reports in this period had no location\./)).toBeInTheDocument()
  })
})
