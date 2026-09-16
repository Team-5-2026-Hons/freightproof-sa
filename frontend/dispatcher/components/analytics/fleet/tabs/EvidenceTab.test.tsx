import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { TabQuery } from '@/lib/format/period'
import type { FleetEvidence } from '@shared/lib/types/fleet-analytics'
import { EvidenceTab } from './EvidenceTab'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

const TODAY = '2026-09-16'
const QUERY: TabQuery = { start: '2026-08-31', end: TODAY, grain: 'week', grainAdjusted: false, disabledGrains: [] }
const PATH = '/api/v1/analytics/fleet/evidence?start=2026-08-31&end=2026-09-16&grain=week'

function makeEvidence(active: boolean): FleetEvidence {
  const n = active ? 1 : 0
  return {
    period: { start: QUERY.start ?? TODAY, end: TODAY, grain: 'week' },
    tracker: [
      { bucket_start: '2026-08-31', is_partial: false, confirmed_count: 3 * n, mismatch_count: n, unwitnessed_count: 2 * n, agreement_rate: active ? 0.75 : null },
    ],
    overrides: [
      { bucket_start: '2026-08-31', is_partial: false, phase_count: 14 * n, override_count: n, override_rate: active ? 1 / 14 : null },
    ],
    receiver_signoff: [
      { bucket_start: '2026-08-31', is_partial: false, confirmation_count: 4 * n, receiver_scan_count: n, receiver_scan_rate: active ? 0.25 : null },
    ],
    signoff_flags: { same_phone_count: n, rejected_attempt_count: 2 * n },
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
  return render(<EvidenceTab query={QUERY} allTimeStart="2026-06-20" today={TODAY} />)
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('EvidenceTab', () => {
  it('asks once for the tab period', async () => {
    mockedGet.mockResolvedValue(makeEvidence(true))

    renderTab()

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(PATH))
  })

  it('keys tracker agreement confirmed, unwitnessed, mismatch and keeps the agreement rate behind the info button', async () => {
    mockedGet.mockResolvedValue(makeEvidence(true))
    renderTab()
    const tracker = await waitFor(() => card('Tracker agreement'))

    expect(await within(tracker).findByText('Confirmed')).toBeInTheDocument()
    expect(within(tracker).getByText('Mismatch')).toBeInTheDocument()
    expect(within(tracker).queryByText(/Agreement 75%/)).toBeNull()
    fireEvent.click(within(tracker).getByRole('button', { name: 'About this chart: Tracker agreement' }))
    expect(within(tracker).getByText(/Agreement 75% \(3 of 4 checked\)/)).toBeInTheDocument()
    expect(await tableRows('Tracker agreement')).toEqual([['31 Aug – 6 Sep 2026', '3', '2', '1', '75%']])
  })

  it('shows the override share with its caption behind the info button', async () => {
    mockedGet.mockResolvedValue(makeEvidence(true))
    renderTab()

    expect(await tableRows('Overrides over time')).toEqual([['31 Aug – 6 Sep 2026', '14', '1', '7%']])
    const overrides = card('Overrides over time')
    fireEvent.click(within(overrides).getByRole('button', { name: 'About this chart: Overrides over time' }))
    expect(within(overrides).getByText(/the weakest evidence we hold/)).toBeInTheDocument()
  })

  it('has no blockchain receipts chart (D25)', async () => {
    mockedGet.mockResolvedValue(makeEvidence(true))
    renderTab()

    await waitFor(() => card('Tracker agreement'))

    expect(screen.queryByRole('heading', { name: 'Blockchain receipts' })).toBeNull()
  })

  it('shows receiver scans with the go-live date on the face and the period flags behind the info button', async () => {
    mockedGet.mockResolvedValue(makeEvidence(true))
    renderTab()
    const signoff = await waitFor(() => card('Receiver sign-off'))

    expect(await within(signoff).findByText('Receiver QR sign-off went live on 13 Sep 2026.')).toBeInTheDocument()
    expect(within(signoff).queryByText(/confirmed from the driver's own phone/)).toBeNull()
    fireEvent.click(within(signoff).getByRole('button', { name: 'About this chart: Receiver sign-off' }))
    expect(within(signoff).getByText(/1 confirmed from the driver's own phone · 2 rejected scan attempts/)).toBeInTheDocument()
    expect(await tableRows('Receiver sign-off')).toEqual([['31 Aug – 6 Sep 2026', '4', '1', '25%']])
  })

  it('says there is not enough data yet when nothing happened', async () => {
    mockedGet.mockResolvedValue(makeEvidence(false))

    renderTab()

    expect(await screen.findByText('No tracker checks at stops in this period.')).toBeInTheDocument()
    expect(screen.getByText('No closed trips departed in this period.')).toBeInTheDocument()
    expect(screen.getByText('No sign-offs on closed trips in this period.')).toBeInTheDocument()
  })
})
