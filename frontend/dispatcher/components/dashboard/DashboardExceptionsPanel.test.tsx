import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardExceptionsPanel } from './DashboardExceptionsPanel'
import { useExceptionQueue, type UseExceptionQueueResult } from '@/lib/hooks/useExceptions'
import { ROUTES } from '@/lib/constants/routes'
import type { TripExceptionListItem } from '@shared/lib/types/exception'

vi.mock('@/lib/hooks/useExceptions', () => ({ useExceptionQueue: vi.fn() }))
const mockedQueue = vi.mocked(useExceptionQueue)

const exception = (id: string, overrides: Partial<TripExceptionListItem> = {}): TripExceptionListItem => ({
  id, severity: 'warning', exception_type: 'gps_mismatch', review_status: 'needs_review',
  created_at: '2026-10-20T08:00:00Z', trip_reference: `FP-${id}`, origin_name: 'Johannesburg DC', destination_name: 'Durban Depot',
  ...overrides,
}) as unknown as TripExceptionListItem

const queueState = (overrides: Partial<UseExceptionQueueResult> = {}): UseExceptionQueueResult =>
  ({ items: [], isLoading: false, error: null, refetch: vi.fn(), refetchSilent: vi.fn(), ...overrides })

beforeEach(() => { mockedQueue.mockReset().mockReturnValue(queueState()) })

describe('DashboardExceptionsPanel', () => {
  it('shows five rows, the full count waiting, and a link to the full queue when more are waiting', () => {
    const items = Array.from({ length: 12 }, (_, i) => exception(`e${i}`))
    mockedQueue.mockReturnValue(queueState({ items }))

    render(<DashboardExceptionsPanel />)

    const table = screen.getByRole('table', { name: 'Exceptions awaiting review' })
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 5)
    expect(screen.getByText('12 need review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View all exceptions/ })).toHaveAttribute('href', '/exceptions')
  })

  it('lists a critical ahead of newer warnings', () => {
    const items = [
      exception('warn-new', { created_at: '2026-10-21T08:00:00Z' }),
      exception('crit-old', { severity: 'critical', created_at: '2026-10-18T08:00:00Z' }),
    ]
    mockedQueue.mockReturnValue(queueState({ items }))

    render(<DashboardExceptionsPanel />)

    const links = within(screen.getByRole('table')).getAllByRole('link')
    expect(links[0].getAttribute('aria-label')).toContain('FP-crit-old')
  })

  it('links a row to its exception, returning to the dashboard', () => {
    mockedQueue.mockReturnValue(queueState({ items: [exception('abc')] }))

    render(<DashboardExceptionsPanel />)

    expect(within(screen.getByRole('table')).getByRole('link')).toHaveAttribute('href', `/exceptions/abc?returnTo=${encodeURIComponent(ROUTES.home)}`)
  })

  it('says nothing is waiting, with a zero count, when every exception is reviewed', () => {
    mockedQueue.mockReturnValue(queueState({ items: [exception('done', { review_status: 'reviewed' })] }))

    render(<DashboardExceptionsPanel />)

    expect(screen.getByText('Nothing to review')).toBeInTheDocument()
    expect(screen.getByText('0 need review')).toBeInTheDocument()
  })

  it('shows a failure with a retry, and no count, rather than an empty queue', () => {
    const refetch = vi.fn()
    mockedQueue.mockReturnValue(queueState({ error: 'Network down', refetch }))

    render(<DashboardExceptionsPanel />)

    expect(screen.getByText('Failed to load exceptions')).toBeInTheDocument()
    expect(screen.queryByText(/review$/)).not.toBeInTheDocument()
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps_the_rows_and_says_the_refresh_failed_when_a_refresh_fails_behind_old_data', () => {
    const refetch = vi.fn()
    mockedQueue.mockReturnValue(queueState({ items: [exception('abc')], error: 'Request timed out.', refetch }))

    render(<DashboardExceptionsPanel />)

    expect(within(screen.getByRole('table')).getByRole('link')).toHaveAttribute('href', `/exceptions/abc?returnTo=${encodeURIComponent(ROUTES.home)}`)
    expect(screen.getByText(/Couldn't refresh · showing data from \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.queryByText('Failed to load exceptions')).toBeNull()
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('shows_no_stale_note_when_nothing_failed', () => {
    mockedQueue.mockReturnValue(queueState({ items: [exception('abc')] }))

    render(<DashboardExceptionsPanel />)

    expect(screen.queryByText(/Couldn't refresh/)).toBeNull()
  })
})
