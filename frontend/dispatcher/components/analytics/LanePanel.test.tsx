import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DurationStats, LaneMetrics } from '@shared/lib/types/analytics'
import { LanePanel, type LanePanelProps } from './LanePanel'

const NO_SAMPLES: DurationStats = {
  sample_count: 0, mean: null, minimum: null, maximum: null, median: null, p90: null,
}

function stats(overrides: Partial<DurationStats>): DurationStats {
  return { ...NO_SAMPLES, ...overrides }
}

function makeLane(overrides: Partial<LaneMetrics> = {}): LaneMetrics {
  return {
    origin_precinct_id: 'origin-1' as LaneMetrics['origin_precinct_id'],
    destination_precinct_id: 'dest-1' as LaneMetrics['destination_precinct_id'],
    origin_precinct_name: 'Cape Town DC',
    destination_precinct_name: 'Durban Depot',
    trip_count: 2,
    exception_count: 3,
    actual_transit_minutes: stats({ sample_count: 2, mean: 300, minimum: 240, maximum: 360, median: 300, p90: 348 }),
    schedule_delta_minutes: stats({ sample_count: 1, mean: 20, minimum: 20, maximum: 20, median: 20, p90: 20 }),
    exception_density: 1.5,
    ...overrides,
  }
}

function renderPanel(overrides: Partial<LanePanelProps> = {}) {
  const props: LanePanelProps = {
    rows: [makeLane()], isLoading: false, error: null, onRetry: vi.fn(), ...overrides,
  }
  render(<LanePanel {...props} />)
}

function cellUnder(header: string): HTMLElement {
  const index = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === header)
  const [, firstRow] = screen.getAllByRole('row')
  return within(firstRow).getAllByRole('cell')[index]
}

describe('LanePanel', () => {
  it('names both ends of the lane', () => {
    renderPanel()

    expect(cellUnder('Lane')).toHaveTextContent('Cape Town DC → Durban Depot')
  })

  it('shows exceptions per trip as a ratio with its counts', () => {
    renderPanel()

    expect(cellUnder('Exceptions per trip')).toHaveTextContent('1.50 (3/2)')
  })

  it('leads each distribution with median and P90, and shows the sample size', () => {
    renderPanel()

    const transit = cellUnder('Transit time')
    expect(transit).toHaveTextContent('Median 5 h · P90 5 h 48 m')
    expect(transit).toHaveTextContent('2 trips')
  })

  it('reads the schedule delta as late or early', () => {
    renderPanel()

    expect(cellUnder('Against schedule')).toHaveTextContent('Median 20 m late')
  })

  it('shows a lane with no planned trips as no data against schedule', () => {
    renderPanel({ rows: [makeLane({ schedule_delta_minutes: NO_SAMPLES })] })

    expect(cellUnder('Against schedule')).toHaveTextContent(/^—$/)
  })

  it('shows a missing precinct name as a dash without hiding the lane', () => {
    renderPanel({ rows: [makeLane({ destination_precinct_name: null })] })

    expect(cellUnder('Lane')).toHaveTextContent('Cape Town DC → —')
  })

  it('sorts a distribution by its median', async () => {
    renderPanel({
      rows: [
        makeLane({ origin_precinct_name: 'Slow', actual_transit_minutes: stats({ sample_count: 1, median: 600 }) }),
        makeLane({ origin_precinct_name: 'Fast', actual_transit_minutes: stats({ sample_count: 1, median: 60 }) }),
      ],
    })

    await userEvent.click(screen.getByRole('columnheader', { name: 'Transit time' }))

    const lanes = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(lanes).toEqual(['Fast → Durban Depot', 'Slow → Durban Depot'])
  })
})
