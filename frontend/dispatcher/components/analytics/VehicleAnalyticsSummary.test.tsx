import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { defaultMonthRange, fmtMonthRange } from '@/lib/format/month'
import { useVehicleAnalytics, useVehicleStreaks, type AnalyticsResult } from '@/lib/hooks/useAnalytics'
import type { VehicleMetrics, VehicleStreak } from '@shared/lib/types/analytics'
import type { VehicleType } from '@shared/lib/types/vehicle'
import { ANALYTICS_COPY } from './copy'
import { VehicleAnalyticsSummary } from './VehicleAnalyticsSummary'

// The hooks' fetching, range keying and stale-reply handling are covered by
// useAnalytics.test.tsx. Here they are stubbed so each test sets the state it needs.
vi.mock('@/lib/hooks/useAnalytics', () => ({
  useVehicleAnalytics: vi.fn(),
  useVehicleStreaks: vi.fn(),
}))

const mockedVehicles = vi.mocked(useVehicleAnalytics)
const mockedStreaks = vi.mocked(useVehicleStreaks)

const VEHICLE_ID = 'vehicle-1' as VehicleMetrics['vehicle_id']
const OTHER_ID = 'vehicle-2' as VehicleMetrics['vehicle_id']

const LONGEST = 'Longest run with no breakdown'
const SHORTEST = 'Shortest completed clean run'
const SINCE_LAST = 'Trips since the last breakdown'
const MEAN = 'Mean time between breakdowns'

function makeVehicle(overrides: Partial<VehicleMetrics> = {}): VehicleMetrics {
  return {
    vehicle_id: VEHICLE_ID,
    registration: 'CA 123-456',
    vehicle_type: 'horse',
    trip_count: 4,
    mechanical_exceptions_count: 3,
    mechanical_info_count: 1,
    mechanical_warning_count: 2,
    mechanical_critical_count: 0,
    mechanical_gap_minutes_sum: 600,
    mechanical_gap_count: 2,
    driving_hours_sum: 20,
    mean_minutes_between_mechanical: 300,
    ...overrides,
  }
}

function makeStreak(overrides: Partial<VehicleStreak> = {}): VehicleStreak {
  return {
    vehicle_id: VEHICLE_ID,
    highest_streak_trips: 7,
    lowest_streak_trips: null,
    trips_since_last_incident: 7,
    ...overrides,
  }
}

function makeResult<T>(overrides: Partial<AnalyticsResult<T>>): AnalyticsResult<T> {
  return { rows: [], isLoading: false, error: null, refetch: vi.fn(), ...overrides }
}

function renderSummary(
  vehicles: Partial<AnalyticsResult<VehicleMetrics>> = {},
  streaks: Partial<AnalyticsResult<VehicleStreak>> = {},
  vehicleType: VehicleType = 'horse',
) {
  const vehiclesResult = makeResult<VehicleMetrics>({ rows: [makeVehicle()], ...vehicles })
  const streaksResult = makeResult<VehicleStreak>({ rows: [makeStreak()], ...streaks })
  mockedVehicles.mockReturnValue(vehiclesResult)
  mockedStreaks.mockReturnValue(streaksResult)

  render(<VehicleAnalyticsSummary vehicleId={VEHICLE_ID} vehicleType={vehicleType} />)

  return { vehicles: vehiclesResult, streaks: streaksResult }
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

describe('VehicleAnalyticsSummary — loading and errors', () => {
  it('shows a spinner while either request is loading', () => {
    renderSummary({}, { isLoading: true })

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText('Trips')).not.toBeInTheDocument()
  })

  it('shows the error, and retry refetches only the monthly request when only it failed', () => {
    const { vehicles, streaks } = renderSummary({ rows: [], error: 'Request failed' })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    expect(screen.getByText('Request failed')).toBeInTheDocument()
    expect(vehicles.refetch).toHaveBeenCalledTimes(1)
    expect(streaks.refetch).not.toHaveBeenCalled()
  })

  it('retries only the streaks request when only it failed', () => {
    const { vehicles, streaks } = renderSummary({}, { rows: [], error: 'Request failed' })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(streaks.refetch).toHaveBeenCalledTimes(1)
    expect(vehicles.refetch).not.toHaveBeenCalled()
  })

  it('keeps the month range control on screen after a failure', () => {
    renderSummary({ rows: [], error: 'Request failed' })

    // From month, From year, To month, To year.
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
  })
})

describe('VehicleAnalyticsSummary — selected months', () => {
  it('names the selected months beside the heading', () => {
    renderSummary()

    expect(screen.getByText(fmtMonthRange(defaultMonthRange()))).toBeInTheDocument()
  })

  it("shows this vehicle's figures, not another vehicle's", () => {
    renderSummary(
      { rows: [makeVehicle({ vehicle_id: OTHER_ID, trip_count: 99 }), makeVehicle()] },
      { rows: [makeStreak({ vehicle_id: OTHER_ID, highest_streak_trips: 50 }), makeStreak()] },
    )

    expect(valueOf('Trips')).toBe('4')
    expect(valueOf(LONGEST)).toBe('7 trips')
  })

  it('keeps mechanical severities as three separate figures, never summed', () => {
    renderSummary()

    expect(valueOf('Info')).toBe('1')
    expect(valueOf('Warning')).toBe('2')
    expect(valueOf('Critical')).toBe('0')
    // mechanical_exceptions_count (3) is their sum and must not appear anywhere.
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('marks each severity that happened, and no severity that did not', () => {
    renderSummary()

    expect(hasSeverityDot('Info')).toBe(true)
    expect(hasSeverityDot('Warning')).toBe(true)
    expect(hasSeverityDot('Critical')).toBe(false)
  })

  it('formats the durations', () => {
    renderSummary()

    expect(valueOf(MEAN)).toBe('5 h')
    expect(valueOf('Driving time')).toBe('20 h')
  })

  it('says no breakdowns were recorded only when there were none', () => {
    renderSummary({ rows: [makeVehicle({
      mechanical_exceptions_count: 0, mechanical_info_count: 0, mechanical_warning_count: 0,
      mechanical_critical_count: 0, mechanical_gap_count: 0, mean_minutes_between_mechanical: null,
    })] })

    expect(valueOf(MEAN)).toBe('No breakdowns recorded')
  })

  it('shows a dash, not "no breakdowns", after a single breakdown with no gap yet', () => {
    // The vehicle's first-ever breakdown has no earlier one to measure a gap from.
    renderSummary({ rows: [makeVehicle({
      mechanical_exceptions_count: 1, mechanical_info_count: 0, mechanical_warning_count: 1,
      mechanical_critical_count: 0, mechanical_gap_count: 0, mean_minutes_between_mechanical: null,
    })] })

    expect(valueOf(MEAN)).toBe('—')
  })
})

describe('VehicleAnalyticsSummary — whole history', () => {
  it('shows each streak with its unit', () => {
    renderSummary({}, { rows: [makeStreak({ highest_streak_trips: 7, trips_since_last_incident: 3 })] })

    expect(valueOf(LONGEST)).toBe('7 trips')
    expect(valueOf(SINCE_LAST)).toBe('3 trips')
  })

  it('uses the singular for one trip', () => {
    renderSummary({}, { rows: [makeStreak({ trips_since_last_incident: 1 })] })

    expect(valueOf(SINCE_LAST)).toBe('1 trip')
  })

  it('shows a shortest run before any breakdown as a dash, not 0', () => {
    renderSummary()

    expect(valueOf(SHORTEST)).toBe('—')
  })

  it('shows a genuine zero-length run as 0', () => {
    renderSummary({}, { rows: [makeStreak({ lowest_streak_trips: 0 })] })

    expect(valueOf(SHORTEST)).toBe('0 trips')
  })

  it('says the figures ignore the selected months', () => {
    renderSummary()

    expect(screen.getByText(/not the months above/)).toBeInTheDocument()
  })
})

describe('VehicleAnalyticsSummary — no closed trips in the range', () => {
  it('shows the empty note instead of zeros', () => {
    renderSummary({ rows: [makeVehicle({ vehicle_id: OTHER_ID })] })

    expect(screen.getByText(ANALYTICS_COPY.empty.title)).toBeInTheDocument()
    expect(screen.getByText(fmtMonthRange(defaultMonthRange()))).toBeInTheDocument()
    expect(screen.queryByText('Trips')).not.toBeInTheDocument()
    expect(screen.queryByText('Info')).not.toBeInTheDocument()
  })

  it('still shows the whole-history figures', () => {
    renderSummary({ rows: [] })

    expect(valueOf(LONGEST)).toBe('7 trips')
    expect(valueOf(SINCE_LAST)).toBe('7 trips')
  })

  it('shows dashes for the whole-history figures when the vehicle has no streak row either', () => {
    renderSummary({ rows: [] }, { rows: [] })

    expect(valueOf(LONGEST)).toBe('—')
    expect(valueOf(SHORTEST)).toBe('—')
    expect(valueOf(SINCE_LAST)).toBe('—')
  })
})

// Trailer analytics: a trailer's breakdowns count only from when drivers began naming the
// vehicle, so its earlier trips read as clean — and the page has to say so.
describe('VehicleAnalyticsSummary — trailer note', () => {
  it("tells a trailer's reader why its earlier trips read as clean", () => {
    renderSummary({}, {}, 'trailer')

    expect(screen.getByText(ANALYTICS_COPY.trailerNote)).toBeInTheDocument()
  })

  it('shows no trailer note on a horse', () => {
    renderSummary()

    expect(screen.queryByText(ANALYTICS_COPY.trailerNote)).not.toBeInTheDocument()
  })
})
