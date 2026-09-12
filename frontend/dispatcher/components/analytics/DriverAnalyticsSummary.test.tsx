import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { defaultMonthRange, fmtMonthRange } from '@/lib/format/month'
import { useDriverAnalytics, type AnalyticsResult } from '@/lib/hooks/useAnalytics'
import type { DriverMetrics } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'
import { DriverAnalyticsSummary } from './DriverAnalyticsSummary'

// The hook's fetching, range keying and stale-reply handling are covered by
// useAnalytics.test.tsx. Here it is stubbed so each test sets the state it needs.
vi.mock('@/lib/hooks/useAnalytics', () => ({
  useDriverAnalytics: vi.fn(),
}))

const mockedDrivers = vi.mocked(useDriverAnalytics)

const DRIVER_ID = 'driver-1' as DriverMetrics['driver_id']
const OTHER_ID = 'driver-2' as DriverMetrics['driver_id']

function makeDriver(overrides: Partial<DriverMetrics> = {}): DriverMetrics {
  return {
    driver_id: DRIVER_ID,
    driver_name: 'Test Driver',
    trip_count: 11,
    trips_with_exceptions_count: 2,
    total_exceptions_count: 3,
    info_exceptions_count: 1,
    warning_exceptions_count: 2,
    critical_exceptions_count: 0,
    departures_with_plan_count: 9,
    on_time_departures_count: 6,
    activation_dwell_minutes_sum: 132,
    activation_dwell_events_count: 11,
    loading_dwell_minutes_sum: 715,
    loading_dwell_events_count: 11,
    departure_dwell_minutes_sum: 220,
    departure_dwell_events_count: 11,
    unloading_dwell_minutes_sum: 495,
    unloading_dwell_events_count: 11,
    confirmation_dwell_minutes_sum: 330,
    confirmation_dwell_events_count: 11,
    phase_events_count: 77,
    override_count: 3,
    exception_trip_rate: 2 / 11,
    on_time_departure_rate: 6 / 9,
    override_rate: 3 / 77,
    activation_dwell_minutes_avg: 12,
    loading_dwell_minutes_avg: 65,
    departure_dwell_minutes_avg: 20,
    unloading_dwell_minutes_avg: 45,
    confirmation_dwell_minutes_avg: 30,
    ...overrides,
  }
}

function renderSummary(overrides: Partial<AnalyticsResult<DriverMetrics>> = {}) {
  const result: AnalyticsResult<DriverMetrics> = {
    rows: [makeDriver()], isLoading: false, error: null, refetch: vi.fn(), ...overrides,
  }
  mockedDrivers.mockReturnValue(result)

  render(<DriverAnalyticsSummary driverId={DRIVER_ID} />)

  return result
}

/** The <dd> holding a figure: its label's <dt> always comes first in the DOM. */
function figureFor(label: string): HTMLElement {
  const figure = screen.getByText(label).nextElementSibling
  if (!(figure instanceof HTMLElement)) throw new Error(`No figure after "${label}"`)
  return figure
}

function valueOf(label: string): string | null {
  return figureFor(label).textContent
}

function hasSeverityDot(label: string): boolean {
  return figureFor(label).querySelector('[aria-hidden="true"]') !== null
}

describe('DriverAnalyticsSummary — loading and errors', () => {
  it('shows a spinner while loading', () => {
    renderSummary({ rows: [], isLoading: true })

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText('Trips')).not.toBeInTheDocument()
  })

  it('shows the error with a retry that refetches', () => {
    const result = renderSummary({ rows: [], error: 'Request failed' })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    expect(screen.getByText('Request failed')).toBeInTheDocument()
    expect(result.refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the month range control on screen after a failure', () => {
    renderSummary({ rows: [], error: 'Request failed' })

    // From month, From year, To month, To year.
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
  })
})

describe('DriverAnalyticsSummary — populated', () => {
  it('names the selected months beside the heading', () => {
    renderSummary()

    expect(screen.getByText(fmtMonthRange(defaultMonthRange()))).toBeInTheDocument()
  })

  it("shows this driver's figures, not another driver's", () => {
    renderSummary({ rows: [makeDriver({ driver_id: OTHER_ID, trip_count: 99 }), makeDriver()] })

    expect(valueOf('Trips')).toBe('11')
  })

  it('shows every rate with the counts it came from', () => {
    renderSummary()

    expect(valueOf('On-time departures')).toBe('67% (6/9)')
    expect(valueOf('Dispatcher overrides')).toBe('4% (3/77)')
    expect(valueOf('Trips with exceptions')).toBe('18% (2/11)')
  })

  it('shows a rate with no denominator as a dash, never 0%', () => {
    renderSummary({ rows: [makeDriver({
      departures_with_plan_count: 0, on_time_departures_count: 0, on_time_departure_rate: null,
    })] })

    expect(valueOf('On-time departures')).toBe('—')
  })

  it('keeps severities as three separate figures, never summed', () => {
    renderSummary()

    expect(valueOf('Info')).toBe('1')
    expect(valueOf('Warning')).toBe('2')
    expect(valueOf('Critical')).toBe('0')
    // total_exceptions_count (3) is their sum and must not appear anywhere.
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('marks each severity that happened, and no severity that did not', () => {
    renderSummary()

    expect(hasSeverityDot('Info')).toBe(true)
    expect(hasSeverityDot('Warning')).toBe(true)
    expect(hasSeverityDot('Critical')).toBe(false)
  })

  it('shows the average time in each phase', () => {
    renderSummary()

    expect(valueOf('Activation')).toBe('12 m')
    expect(valueOf('Loading')).toBe('1 h 5 m')
    expect(valueOf('Departure')).toBe('20 m')
    expect(valueOf('Unloading')).toBe('45 m')
    expect(valueOf('Confirmation')).toBe('30 m')
  })

  it('shows a phase with no observations as a dash, not 0 m', () => {
    renderSummary({ rows: [makeDriver({
      unloading_dwell_minutes_sum: 0, unloading_dwell_events_count: 0, unloading_dwell_minutes_avg: null,
    })] })

    expect(valueOf('Unloading')).toBe('—')
  })

  it('prints the slow-receiver caveat with the confirmation figure itself', () => {
    renderSummary()

    expect(screen.getByText('Confirmation')).toContainElement(
      screen.getByText(ANALYTICS_COPY.confirmationDwellCaveat),
    )
  })

  it('shows no score, rating or rank (decision 06)', () => {
    renderSummary()

    expect(document.body.textContent).not.toMatch(/score|rating|rank/i)
  })
})

describe('DriverAnalyticsSummary — no closed trips in the range', () => {
  it('shows the empty note instead of zeros', () => {
    renderSummary({ rows: [makeDriver({ driver_id: OTHER_ID })] })

    expect(screen.getByText(ANALYTICS_COPY.empty.title)).toBeInTheDocument()
    expect(screen.getByText(fmtMonthRange(defaultMonthRange()))).toBeInTheDocument()
    expect(screen.queryByText('Trips')).not.toBeInTheDocument()
    expect(screen.queryByText('Info')).not.toBeInTheDocument()
    expect(screen.queryByText('Confirmation')).not.toBeInTheDocument()
  })
})
