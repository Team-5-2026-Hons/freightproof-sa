import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { FacilityMetrics } from '@shared/lib/types/analytics'
import { FacilityPanel, type FacilityPanelProps } from './FacilityPanel'

function makeFacility(overrides: Partial<FacilityMetrics> = {}): FacilityMetrics {
  return {
    precinct_id: 'precinct-1' as FacilityMetrics['precinct_id'],
    precinct_name: 'Durban Depot',
    confirmed_count: 1,
    mismatch_count: 1,
    unwitnessed_count: 5,
    corroboration_rate: 0.5,
    ...overrides,
  }
}

function renderPanel(overrides: Partial<FacilityPanelProps> = {}) {
  const props: FacilityPanelProps = {
    rows: [makeFacility()], isLoading: false, error: null, onRetry: vi.fn(), ...overrides,
  }
  render(<FacilityPanel {...props} />)
  return props
}

/** The cell in the first data row under the named column. */
function cellUnder(header: string): HTMLElement {
  const index = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === header)
  const [, firstRow] = screen.getAllByRole('row')
  return within(firstRow).getAllByRole('cell')[index]
}

describe('FacilityPanel', () => {
  it('keeps unwitnessed out of the rate and shows it as its own figure', () => {
    renderPanel()

    // 1 confirmed of 2 CHECKED — the 5 unwitnessed would make it 1/7 if folded in.
    expect(cellUnder('Corroboration rate')).toHaveTextContent('50% (1/2)')
    expect(cellUnder('Unwitnessed (no Pulsit reading)')).toHaveTextContent('5')
  })

  it('shows a precinct with nothing checked as no data, never 0%', () => {
    renderPanel({
      rows: [makeFacility({ confirmed_count: 0, mismatch_count: 0, corroboration_rate: null })],
    })

    expect(cellUnder('Corroboration rate')).toHaveTextContent('—')
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument()
  })

  it('shows a missing precinct name as a dash but keeps the row', () => {
    renderPanel({ rows: [makeFacility({ precinct_name: null })] })

    expect(cellUnder('Precinct')).toHaveTextContent('—')
    expect(cellUnder('Confirmed ✓')).toHaveTextContent('1')
  })

  it('does not call a closed trip "Awaiting Pulsit"', () => {
    renderPanel()

    expect(screen.queryByText(/Awaiting Pulsit/)).not.toBeInTheDocument()
  })

  it('sorts precincts with no data last', async () => {
    renderPanel({
      rows: [
        makeFacility({ precinct_name: 'No checks', confirmed_count: 0, mismatch_count: 0, corroboration_rate: null }),
        makeFacility({ precinct_name: 'Good', confirmed_count: 9, mismatch_count: 1, corroboration_rate: 0.9 }),
        makeFacility({ precinct_name: 'Poor', confirmed_count: 2, mismatch_count: 3, corroboration_rate: 0.4 }),
      ],
    })

    await userEvent.click(screen.getByRole('columnheader', { name: 'Corroboration rate' }))

    const names = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(names).toEqual(['Poor', 'Good', 'No checks'])
  })

  it('shows the empty state when there are no rows', () => {
    renderPanel({ rows: [] })

    expect(screen.getByText('No closed trips in this range')).toBeInTheDocument()
  })

  it('shows the error with a retry', async () => {
    const props = renderPanel({ rows: [], error: 'Internal server error.' })

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Internal server error.')).toBeInTheDocument()
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })
})
