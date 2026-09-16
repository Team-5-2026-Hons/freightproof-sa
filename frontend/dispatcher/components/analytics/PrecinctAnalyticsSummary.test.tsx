import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { defaultMonthRange, fmtMonthRange } from '@/lib/format/month'
import { useFacilityAnalytics, type AnalyticsResult } from '@/lib/hooks/useAnalytics'
import type { FacilityMetrics } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'
import { PrecinctAnalyticsSummary } from './PrecinctAnalyticsSummary'

// The hook's fetching, range keying and stale-reply handling are covered by
// useAnalytics.test.tsx. Here it is stubbed so each test sets the state it needs.
vi.mock('@/lib/hooks/useAnalytics', () => ({
  useFacilityAnalytics: vi.fn(),
}))

const mockedFacilities = vi.mocked(useFacilityAnalytics)

const PRECINCT_ID = 'precinct-1' as FacilityMetrics['precinct_id']
const OTHER_ID = 'precinct-2' as FacilityMetrics['precinct_id']

const RATE = 'Corroboration rate'
const CONFIRMED = 'Confirmed ✓'
const MISMATCH = 'Mismatch ✗'
const UNWITNESSED = 'Unwitnessed (no Pulsit reading)'

function makeFacility(overrides: Partial<FacilityMetrics> = {}): FacilityMetrics {
  return {
    precinct_id: PRECINCT_ID,
    precinct_name: 'Test Depot',
    confirmed_count: 2,
    mismatch_count: 1,
    unwitnessed_count: 4,
    corroboration_rate: 2 / 3,
    ...overrides,
  }
}

function renderSummary(overrides: Partial<AnalyticsResult<FacilityMetrics>> = {}) {
  const result: AnalyticsResult<FacilityMetrics> = {
    rows: [makeFacility()], isLoading: false, error: null, refetch: vi.fn(), ...overrides,
  }
  mockedFacilities.mockReturnValue(result)

  render(<PrecinctAnalyticsSummary precinctId={PRECINCT_ID} />)

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

function hasDot(label: string): boolean {
  return figureFor(label).querySelector('[aria-hidden="true"]') !== null
}

describe('PrecinctAnalyticsSummary — loading and errors', () => {
  it('shows a spinner while loading', () => {
    renderSummary({ rows: [], isLoading: true })

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText(RATE)).not.toBeInTheDocument()
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

describe('PrecinctAnalyticsSummary — populated', () => {
  it('names the selected months beside the heading', () => {
    renderSummary()

    expect(screen.getByText(fmtMonthRange(defaultMonthRange()))).toBeInTheDocument()
  })

  it("shows this precinct's figures, not another precinct's", () => {
    renderSummary({ rows: [makeFacility({ precinct_id: OTHER_ID, confirmed_count: 99 }), makeFacility()] })

    expect(valueOf(CONFIRMED)).toBe('2')
  })

  it('shows the rate with its counts, leaving unwitnessed out of the denominator', () => {
    renderSummary()

    // 2 confirmed of 3 checked. Counting the 4 unwitnessed would make it 2/7.
    expect(valueOf(RATE)).toBe('67% (2/3)')
  })

  it('shows the rate as a dash, never 0%, when nothing was checked', () => {
    renderSummary({ rows: [makeFacility({ confirmed_count: 0, mismatch_count: 0, corroboration_rate: null })] })

    expect(valueOf(RATE)).toBe('—')
    expect(valueOf(UNWITNESSED)).toBe('4')
  })

  it('keeps the three verdicts as separate figures, never summed', () => {
    renderSummary()

    expect(valueOf(CONFIRMED)).toBe('2')
    expect(valueOf(MISMATCH)).toBe('1')
    expect(valueOf(UNWITNESSED)).toBe('4')
    // Their total (7) must not appear anywhere.
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })

  it('marks each verdict that happened, and none that did not', () => {
    renderSummary({ rows: [makeFacility({ mismatch_count: 0, corroboration_rate: 1 })] })

    expect(hasDot(CONFIRMED)).toBe(true)
    expect(hasDot(MISMATCH)).toBe(false)
    expect(hasDot(UNWITNESSED)).toBe(true)
  })

  it('explains the rate in the same words as /analytics, and that only this organisation counts', () => {
    renderSummary()

    expect(screen.getByText(ANALYTICS_COPY.facilityRateNote)).toBeInTheDocument()
    expect(screen.getByText(/Only your organisation's closed trips are counted/)).toBeInTheDocument()
  })
})

describe('PrecinctAnalyticsSummary — no closed trips in the range', () => {
  it('shows the empty note instead of zeros', () => {
    renderSummary({ rows: [makeFacility({ precinct_id: OTHER_ID })] })

    expect(screen.getByText(ANALYTICS_COPY.empty.title)).toBeInTheDocument()
    expect(screen.getByText(fmtMonthRange(defaultMonthRange()))).toBeInTheDocument()
    expect(screen.queryByText(RATE)).not.toBeInTheDocument()
    expect(screen.queryByText(CONFIRMED)).not.toBeInTheDocument()
  })
})
