import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DriverMetrics } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'
import { DriverPanel, type DriverPanelProps } from './DriverPanel'

function makeDriver(overrides: Partial<DriverMetrics> = {}): DriverMetrics {
  return {
    driver_id: 'driver-1' as DriverMetrics['driver_id'],
    driver_name: 'Thandi Mokoena',
    trip_count: 3,
    trips_with_exceptions_count: 2,
    total_exceptions_count: 3,
    info_exceptions_count: 1,
    warning_exceptions_count: 1,
    critical_exceptions_count: 1,
    departures_with_plan_count: 0,
    on_time_departures_count: 0,
    activation_dwell_minutes_sum: 90,
    activation_dwell_events_count: 3,
    loading_dwell_minutes_sum: 180,
    loading_dwell_events_count: 3,
    departure_dwell_minutes_sum: 30,
    departure_dwell_events_count: 3,
    unloading_dwell_minutes_sum: 120,
    unloading_dwell_events_count: 3,
    confirmation_dwell_minutes_sum: 60,
    confirmation_dwell_events_count: 3,
    phase_events_count: 21,
    override_count: 1,
    exception_trip_rate: 2 / 3,
    on_time_departure_rate: null,
    override_rate: 1 / 21,
    activation_dwell_minutes_avg: 30,
    loading_dwell_minutes_avg: 60,
    departure_dwell_minutes_avg: 10,
    unloading_dwell_minutes_avg: 40,
    confirmation_dwell_minutes_avg: 20,
    ...overrides,
  }
}

function renderPanel(overrides: Partial<DriverPanelProps> = {}) {
  const props: DriverPanelProps = {
    rows: [makeDriver()], isLoading: false, error: null, onRetry: vi.fn(), ...overrides,
  }
  render(<DriverPanel {...props} />)
}

function cellUnder(header: string): HTMLElement {
  const index = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === header)
  const [, firstRow] = screen.getAllByRole('row')
  return within(firstRow).getAllByRole('cell')[index]
}

describe('DriverPanel', () => {
  it('shows every rate with the counts it came from', () => {
    renderPanel()

    expect(cellUnder('Trips with exceptions')).toHaveTextContent('67% (2/3)')
    expect(cellUnder('Dispatcher overrides')).toHaveTextContent('5% (1/21)')
  })

  it('shows no planned departures as no data, never 0%', () => {
    renderPanel()

    expect(cellUnder('On-time departures')).toHaveTextContent(/^—$/)
    expect(screen.queryByText(/^0%/)).not.toBeInTheDocument()
  })

  it('shows the confirmation caveat beside that column', () => {
    renderPanel()

    expect(cellUnder('Avg confirmation †')).toHaveTextContent('20 m')
    expect(screen.getByText(ANALYTICS_COPY.confirmationDwellCaveat, { exact: false })).toBeInTheDocument()
  })

  it('keeps exception severities in separate columns', () => {
    renderPanel({ rows: [makeDriver({ info_exceptions_count: 4, warning_exceptions_count: 2, critical_exceptions_count: 1 })] })

    expect(cellUnder('Info exceptions')).toHaveTextContent('4')
    expect(cellUnder('Warning exceptions')).toHaveTextContent('2')
    expect(cellUnder('Critical exceptions')).toHaveTextContent('1')
  })

  it('has no score, rating or rank column', () => {
    renderPanel()

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent ?? '')
    expect(headers.filter((header) => /score|rating|rank/i.test(header))).toEqual([])
  })

  it('opens sorted by name, not as a ranking', () => {
    renderPanel({
      rows: [
        makeDriver({ driver_name: 'Zola', critical_exceptions_count: 5 }),
        makeDriver({ driver_name: 'Amahle', critical_exceptions_count: 0 }),
      ],
    })

    const names = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(names).toEqual(['Amahle', 'Zola'])
  })
})
