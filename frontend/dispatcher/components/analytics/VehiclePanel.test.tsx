import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { VehicleMetrics, VehicleStreak } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'
import { VehiclePanel, joinStreaks, type VehiclePanelProps } from './VehiclePanel'

const VEHICLE_ID = 'vehicle-1' as VehicleMetrics['vehicle_id']
const TRAILER_ID = 'vehicle-trailer' as VehicleMetrics['vehicle_id']

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

function renderPanel(overrides: Partial<VehiclePanelProps> = {}) {
  const props: VehiclePanelProps = {
    vehicles: [makeVehicle()], streaks: [makeStreak()],
    isLoading: false, error: null, onRetry: vi.fn(), ...overrides,
  }
  render(<VehiclePanel {...props} />)
}

function cellUnder(header: string): HTMLElement {
  const index = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === header)
  const [, firstRow] = screen.getAllByRole('row')
  return within(firstRow).getAllByRole('cell')[index]
}

/** Every body row's text in one column, top to bottom. */
function columnText(header: string): string[] {
  const index = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === header)
  return screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[index].textContent ?? '')
}

describe('VehiclePanel', () => {
  it('shows the streak figures beside the monthly numbers', () => {
    renderPanel()

    expect(cellUnder('Trips')).toHaveTextContent('4')
    expect(cellUnder('Longest clean streak')).toHaveTextContent('7')
    expect(cellUnder('Trips since last incident')).toHaveTextContent('7')
  })

  it('shows a lowest streak before any incident as a dash', () => {
    renderPanel()

    expect(cellUnder('Shortest completed streak')).toHaveTextContent('—')
  })

  it('shows a genuine zero-length streak as 0', () => {
    renderPanel({ streaks: [makeStreak({ lowest_streak_trips: 0 })] })

    expect(cellUnder('Shortest completed streak')).toHaveTextContent('0')
  })

  it('keeps mechanical severities in separate columns', () => {
    renderPanel()

    expect(cellUnder('Mechanical (info)')).toHaveTextContent('1')
    expect(cellUnder('Mechanical (warning)')).toHaveTextContent('2')
    expect(cellUnder('Mechanical (critical)')).toHaveTextContent('0')
  })

  it('says the streaks cover whole history, not the selected months', () => {
    renderPanel()

    expect(screen.getByText(/whole history, not only the selected months/)).toBeInTheDocument()
  })

  it('shows no breakdown gap as no data', () => {
    renderPanel({ vehicles: [makeVehicle({ mechanical_gap_count: 0, mean_minutes_between_mechanical: null })] })

    expect(cellUnder('Mean time between breakdowns')).toHaveTextContent('—')
  })

  it("shows each vehicle's type straight after its registration", () => {
    renderPanel({
      vehicles: [
        makeVehicle(),
        makeVehicle({ vehicle_id: TRAILER_ID, registration: 'TRL 222 GP', vehicle_type: 'trailer' }),
      ],
      streaks: [],
    })

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers.indexOf('Type')).toBe(headers.indexOf('Registration') + 1)
    // Sorted by registration: CA 123-456 (the horse), then TRL 222 GP (the trailer).
    expect(columnText('Type')).toEqual(['Horse', 'Trailer'])
  })

  it('shows a missing type as a dash', () => {
    renderPanel({ vehicles: [makeVehicle({ vehicle_type: null })] })

    expect(cellUnder('Type')).toHaveTextContent('—')
  })

  it('says why a trailer\'s earlier trips read as clean', () => {
    renderPanel()

    expect(screen.getByText(ANALYTICS_COPY.trailerNote)).toBeInTheDocument()
  })
})

describe('joinStreaks', () => {
  it('leaves the streak figures null when a vehicle has no streak row', () => {
    const [row] = joinStreaks([makeVehicle()], [])

    expect(row.highest_streak_trips).toBeNull()
    expect(row.trips_since_last_incident).toBeNull()
    expect(row.trip_count).toBe(4)
  })

  it('joins by vehicle id, not by position', () => {
    const other = 'vehicle-2' as VehicleMetrics['vehicle_id']

    const rows = joinStreaks(
      [makeVehicle(), makeVehicle({ vehicle_id: other })],
      [makeStreak({ vehicle_id: other, highest_streak_trips: 2 }), makeStreak({ highest_streak_trips: 9 })],
    )

    expect(rows.map((row) => row.highest_streak_trips)).toEqual([9, 2])
  })
})
