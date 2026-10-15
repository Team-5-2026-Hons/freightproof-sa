import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { buildTripColumns, exceptionsLabel, planPosition, tripRowClassName } from './tripColumns'
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

  it('puts exceptions right after the trip on the dashboard and never folds them; History keeps its order', () => {
    const dashboard = buildTripColumns<TripChecklistItem>({ precincts: [], date: DATE, showProgress: true })
    const history = buildTripColumns<TripChecklistItem>({ precincts: [], date: DATE, showProgress: false })

    expect(dashboard.map(c => c.id)).toEqual(['date', 'trip', 'exceptions', 'manifest', 'driver', 'route', 'status'])
    expect(dashboard.find(c => c.id === 'exceptions')?.hideBelow).toBeUndefined()
    expect(history.map(c => c.id)).toEqual(['date', 'trip', 'manifest', 'driver', 'route', 'exceptions', 'status'])
    expect(history.find(c => c.id === 'exceptions')?.hideBelow).toBeGreaterThan(0)
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

describe('exceptionsLabel', () => {
  it('is null when nothing needs review, and a plain count on rows without the split', () => {
    expect(exceptionsLabel(trip())).toBeNull()
    expect(exceptionsLabel(trip({ needs_review_count: 1 }))).toBe('⚠ 1 exception')
  })

  it('names critical exceptions and says whether anyone has claimed them', () => {
    const split = (critical: number, warning: number, claimed: number) => trip({
      needs_review_count: critical + warning,
      attention: { critical, warning, info: 0, claimed },
    })

    expect(exceptionsLabel(split(1, 2, 1))).toBe('⚠ 3 exceptions · 1 critical · 2 unclaimed')
    expect(exceptionsLabel(split(0, 1, 0))).toBe('⚠ 1 exception · unclaimed')
    expect(exceptionsLabel(split(0, 2, 2))).toBe('⚠ 2 exceptions · all claimed')
  })
})

describe('planPosition', () => {
  it('gives the stop and count, and nothing where the chip already says it all', () => {
    expect(planPosition(trip())).toBe('Origin · 1/7')
    expect(planPosition(trip({ current_stop: 2 }))).toBe('Stop 3 · 1/7')
    expect(planPosition(trip({ status: 'closed' }))).toBeNull()
    expect(planPosition(trip({ status: 'cancelled' }))).toBeNull()
    expect(planPosition(trip({ current_phase: null }))).toBeNull()
  })
})

describe('status cell', () => {
  it('shows the plan position under the chip on the dashboard only', () => {
    const { unmount } = render(<>{cell('status', trip(), NOTHING_HIDDEN, true)}</>)
    expect(screen.getByText('Origin · 1/7')).toBeInTheDocument()
    unmount()

    render(<>{cell('status', trip(), NOTHING_HIDDEN, false)}</>)
    expect(screen.queryByText('Origin · 1/7')).toBeNull()
  })

  it('reads a critical in the error colour and lesser exceptions in the warning colour', () => {
    const critical = trip({ needs_review_count: 1, attention: { critical: 1, warning: 0, info: 0, claimed: 0 } })
    const warning = trip({ needs_review_count: 1, attention: { critical: 0, warning: 1, info: 0, claimed: 0 } })

    render(<>{cell('exceptions', critical, NOTHING_HIDDEN, true)}{cell('exceptions', warning, NOTHING_HIDDEN, true)}</>)

    expect(screen.getByText(/1 critical/)).toHaveClass('text-err')
    expect(screen.getByText(/1 exception · unclaimed/)).toHaveClass('text-warn')
  })
})
