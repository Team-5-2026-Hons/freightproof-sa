import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { TabQuery } from '@/lib/format/period'
import type { FleetReview } from '@shared/lib/types/fleet-analytics'
import { ReviewDeskTab } from './ReviewDeskTab'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

const TODAY = '2026-09-16'
const QUERY: TabQuery = { start: '2026-08-31', end: TODAY, grain: 'week', grainAdjusted: false, disabledGrains: [] }
const PATH = '/api/v1/analytics/fleet/review?start=2026-08-31&end=2026-09-16&grain=week'

function makeReview(reviewed: boolean): FleetReview {
  return {
    period: { start: QUERY.start ?? TODAY, end: TODAY, grain: 'week' },
    waiting_by_age: [
      { band: 'under_1h', count: 1 }, { band: '1h_to_24h', count: 0 }, { band: '1d_to_3d', count: 0 }, { band: 'over_3d', count: 1 },
    ],
    queue: [
      { bucket_start: '2026-08-31', is_partial: false, waiting_at_end: 2 },
      { bucket_start: '2026-09-07', is_partial: false, waiting_at_end: 1 },
    ],
    time_to_review: [
      { bucket_start: '2026-08-31', is_partial: false, reviewed_count: reviewed ? 1 : 0, median_hours: reviewed ? 48 : null, mean_hours: reviewed ? 48 : null },
      { bucket_start: '2026-09-07', is_partial: false, reviewed_count: reviewed ? 2 : 0, median_hours: reviewed ? 1.5 : null, mean_hours: reviewed ? 2.25 : null },
    ],
    outcomes: [
      { outcome: 'no_action_required', count: reviewed ? 1 : 0 },
      { outcome: 'handled_externally', count: 0 },
      { outcome: 'evidence_verified', count: reviewed ? 1 : 0 },
      { outcome: 'data_discrepancy', count: reviewed ? 3 : 0 },
      { outcome: 'referred_for_follow_up', count: 0 },
    ],
  }
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('section')
  if (element === null) throw new Error(`no card titled ${title}`)
  return element
}

async function tableRows(title: string): Promise<(string | null)[][]> {
  const element = await waitFor(() => card(title))
  fireEvent.click(await within(element).findByRole('button', { name: 'Show table' }))
  return within(element).getAllByRole('row').slice(1).map((row) =>
    within(row).getAllByRole('cell').map((cell) => cell.textContent))
}

function renderTab() {
  return render(<ReviewDeskTab query={QUERY} allTimeStart="2026-06-20" today={TODAY} />)
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('ReviewDeskTab', () => {
  it('asks once and says the tab covers open and closed trips alike', async () => {
    mockedGet.mockResolvedValue(makeReview(true))

    renderTab()

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(PATH))
    expect(screen.getByText(/on open and closed trips alike/)).toBeInTheDocument()
  })

  it('bands the waiting queue by age and links to it', async () => {
    mockedGet.mockResolvedValue(makeReview(true))
    renderTab()

    expect(await tableRows('Waiting now, by age')).toEqual([
      ['Under 1 h', '1'], ['1–24 h', '0'], ['1–3 days', '0'], ['Over 3 days', '1'],
    ])
    expect(within(card('Waiting now, by age')).getByRole('link', { name: 'Open the review queue' })).toHaveAttribute('href', '/exceptions')
  })

  it('shows the pile at the end of each week', async () => {
    mockedGet.mockResolvedValue(makeReview(true))
    renderTab()

    expect(await tableRows('Is the pile growing?')).toEqual([['31 Aug – 6 Sep 2026', '2'], ['7–13 Sep 2026', '1']])
  })

  it('shows the typical and the average wait side by side', async () => {
    mockedGet.mockResolvedValue(makeReview(true))
    renderTab()

    expect(await tableRows('How fast critical problems get reviewed')).toEqual([
      ['31 Aug – 6 Sep 2026', '1', '48 h', '48 h'],
      ['7–13 Sep 2026', '2', '1 h 30 m', '2 h 15 m'],
    ])
  })

  it('draws the outcomes as a donut with the total in the middle and count and share in the legend', async () => {
    mockedGet.mockResolvedValue(makeReview(true))
    renderTab()
    const outcomes = await waitFor(() => card('What reviews concluded'))

    expect(await within(outcomes).findByText('5 reviews')).toBeInTheDocument()
    expect(within(outcomes).getByText('Data discrepancy · 3 · 60%')).toBeInTheDocument()
    expect(within(outcomes).getByText('Handled elsewhere · 0 · 0%')).toBeInTheDocument()
  })

  it('lists the five outcomes with their share and the false-alarm caption in the popover', async () => {
    mockedGet.mockResolvedValue(makeReview(true))
    renderTab()

    expect(await tableRows('What reviews concluded')).toEqual([
      ['No action needed', '1', '20%'], ['Handled elsewhere', '0', '0%'], ['Evidence confirmed', '1', '20%'],
      ['Data discrepancy', '3', '60%'], ['Referred for follow-up', '0', '0%'],
    ])
    const outcomes = card('What reviews concluded')
    fireEvent.click(within(outcomes).getByRole('button', { name: 'About this chart: What reviews concluded' }))
    expect(within(outcomes).getByText(/raising false alarms/)).toBeInTheDocument()
  })

  it('keeps drawing waiting charts with zeros but says so when nothing was reviewed', async () => {
    mockedGet.mockResolvedValue(makeReview(false))

    renderTab()

    expect(await screen.findByText('No critical problems were reviewed in this period.')).toBeInTheDocument()
    expect(screen.getByText('No reviews were concluded in this period.')).toBeInTheDocument()
    expect(within(card('Is the pile growing?')).getByRole('button', { name: 'Show table' })).toBeInTheDocument()
  })
})
