import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { buildTripColumns, progressHint, tripRowClassName } from './tripColumns'
import type { TableRenderContext } from '@/components/ui/Table'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripChecklistItem } from '@shared/lib/types/trip'

const NOTHING_HIDDEN: TableRenderContext = { hidden: new Set() }
const DATE = { label: 'Created', pick: (trip: TripChecklistItem): string => trip.created_at }

function trip(overrides: Partial<TripChecklistItem> = {}): TripChecklistItem {
  return {
    id: 'trip-1' as TripChecklistItem['id'],
    trip_reference: 'FP-20261001-AB12CD34',
    pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' },
    status: 'created',
    driver: { full_name: 'Sipho Dlamini' },
    horse: { registration: 'GP 12-34 ZX' },
    origin_precinct_id: null,
    destination_precinct_id: null,
    needs_review_count: 0,
    created_at: '2026-10-01T08:00:00Z',
    current_phase: 'trip_creation',
    current_stop: 0,
    phase_total: 7,
    phase_completed: 1,
    ...overrides,
  }
}

function cell(columnId: string, row: TripChecklistItem, context: TableRenderContext = NOTHING_HIDDEN, showProgress = false): ReactNode {
  const column = buildTripColumns<TripChecklistItem>({ precincts: [] as Precinct[], date: DATE, showProgress }).find(c => c.id === columnId)
  if (!column) throw new Error(`no column ${columnId}`)
  return column.render(row, context)
}

describe('trip columns', () => {
  it('labels the date column as the caller asks', () => {
    const columns = buildTripColumns<TripChecklistItem>({ precincts: [], date: DATE, showProgress: false })

    expect(columns[0].label).toBe('Created')
  })

  it('shows the manifest key first and the client beneath it', () => {
    render(<>{cell('manifest', trip())}</>)

    const [key, client] = screen.getAllByText(/JNB 69|CGY Logistics/)
    expect(key).toHaveTextContent('JNB 69')
    expect(client).toHaveTextContent('CGY Logistics')
  })

  it('says "Empty leg" for an active empty leg and "No manifest" when a row cannot prove one', () => {
    const { unmount } = render(<>{cell('manifest', trip({ pp_manifest: null, trip_type: 'empty_leg' }))}</>)
    expect(screen.getByText('Empty leg')).toBeInTheDocument()
    unmount()

    render(<>{cell('manifest', trip({ pp_manifest: null }))}</>)
    expect(screen.getByText('No manifest')).toBeInTheDocument()
  })

  it('moves the manifest under the trip ID while the manifest column is hidden', () => {
    const { unmount } = render(<>{cell('trip', trip())}</>)
    expect(screen.queryByText('CGY Logistics · JNB 69')).toBeNull()
    unmount()

    render(<>{cell('trip', trip(), { hidden: new Set(['manifest']) })}</>)
    expect(screen.getByText('CGY Logistics · JNB 69')).toBeInTheDocument()
  })

  it('moves the exceptions note under the status chip while that column is hidden', () => {
    const row = trip({ needs_review_count: 2 })
    const { unmount } = render(<>{cell('status', row)}</>)
    expect(screen.queryByText(/2 exceptions/)).toBeNull()
    unmount()

    render(<>{cell('status', row, { hidden: new Set(['exceptions']) })}</>)
    expect(screen.getByText(/2 exceptions/)).toBeInTheDocument()
  })

  it('falls back to an em dash for an unknown route and a missing horse', () => {
    render(<>{cell('route', trip())}{cell('driver', trip({ horse: undefined as unknown as TripChecklistItem['horse'] }))}</>)

    expect(screen.getByText('↓ —')).toBeInTheDocument()
  })

  it('never says "No exceptions" for a history row with nothing to review', () => {
    render(<>{cell('exceptions', trip({ status: 'closed' }))}</>)

    expect(screen.getByText('None need review')).toBeInTheDocument()
  })

  it('marks only trips that need review', () => {
    expect(tripRowClassName(trip({ needs_review_count: 1 }))).toContain('shadow-')
    expect(tripRowClassName(trip())).toBeUndefined()
  })
})

describe('progressHint', () => {
  it('leads with exceptions, then terminal states, then the phase', () => {
    expect(progressHint(trip({ needs_review_count: 1 }))).toBe('⚠ 1 exception')
    expect(progressHint(trip({ status: 'closed' }))).toBe('✓ Closed')
    expect(progressHint(trip({ status: 'cancelled' }))).toBe('Cancelled')
    expect(progressHint(trip({ current_phase: null }))).toBe('Pending start')
    expect(progressHint(trip())).toMatch(/· Origin · 1\/7$/)
  })
})
