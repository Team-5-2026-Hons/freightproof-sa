import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import ExceptionsPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useExceptionQueue } from '@/lib/hooks/useExceptions'
import { useExceptionHistory } from '@/lib/hooks/useExceptionHistory'
import type { UseExceptionQueueResult } from '@/lib/hooks/useExceptions'
import type { UseExceptionHistoryResult } from '@/lib/hooks/useExceptionHistory'
import type { TripExceptionListItem } from '@shared/lib/types/exception'
import { COPY } from '@shared/lib/constants/copy'

// client.ts imports the Supabase client at module scope, which throws without real env
// vars — mocked the same way the exceptions/[id] page test does.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// ForensicModeProvider (mounted via TopBar -> ForensicControls) reads the signed-in
// user. Nothing these tests assert depends on who that is, so identity is stubbed
// rather than standing up a real AuthProvider — same approach as the [id] page test.
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useExceptions', () => ({
  useExceptionQueue: vi.fn(),
}))

vi.mock('@/lib/hooks/useExceptionHistory', () => ({
  useExceptionHistory: vi.fn(),
}))

const mockedUseExceptionQueue = vi.mocked(useExceptionQueue)
const mockedUseExceptionHistory = vi.mocked(useExceptionHistory)

function makeQueueItem(overrides: Partial<TripExceptionListItem> = {}): TripExceptionListItem {
  return {
    id: 'exc-1' as TripExceptionListItem['id'],
    exception_type: 'seal_mismatch',
    source: 'system',
    severity: 'critical',
    review_status: 'needs_review',
    description: 'Seal at destination does not match departure.',
    created_at: '2026-09-03T10:00:00Z',
    trip_id: 'trip-1',
    trip_reference: 'FP-2026-0001',
    trip_status: 'active',
    phase_label: 'In Transit',
    stop_label: 2,
    ...overrides,
  }
}

function makeHistoryItem(overrides: Partial<TripExceptionListItem> = {}): TripExceptionListItem {
  return {
    ...makeQueueItem(),
    id: 'exc-h1' as TripExceptionListItem['id'],
    review_status: 'recorded',
    trip_status: 'closed',
    ...overrides,
  }
}

function queueState(overrides: Partial<UseExceptionQueueResult> = {}): UseExceptionQueueResult {
  return {
    items: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    refetchSilent: vi.fn(),
    ...overrides,
  }
}

function historyState(overrides: Partial<UseExceptionHistoryResult> = {}): UseExceptionHistoryResult {
  return {
    items: [],
    isLoading: false,
    error: null,
    isStale: false,
    totalItems: 0,
    page: 1,
    pageSize: 25,
    hasPrevious: false,
    hasNext: false,
    goToNextPage: vi.fn(),
    goToPreviousPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  }
}

function renderPage() {
  return render(
    <ForensicModeProvider>
      <ExceptionsPage />
    </ForensicModeProvider>,
  )
}

function goToHistoryTab() {
  fireEvent.click(screen.getByRole('button', { name: 'History' }))
}

beforeEach(() => {
  push.mockReset()
  mockedUseExceptionQueue.mockReset().mockReturnValue(queueState())
  mockedUseExceptionHistory.mockReset().mockReturnValue(historyState())
})

describe('Needs Review tab', () => {
  it('reflects the queue hook item count in the tab badge', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [makeQueueItem(), makeQueueItem({ id: 'exc-2' as TripExceptionListItem['id'] }), makeQueueItem({ id: 'exc-3' as TripExceptionListItem['id'] })] }))

    renderPage()

    const tabButton = screen.getByRole('button', { name: /needs review/i })
    expect(within(tabButton).getByText('3')).toBeInTheDocument()
  })

  it('never renders pagination controls, even with many queue items', () => {
    const many = Array.from({ length: 60 }, (_, i) => makeQueueItem({ id: `exc-${i}` as TripExceptionListItem['id'] }))
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: many }))

    renderPage()

    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })

  it('shows an all-clear empty state when the queue is empty with no error', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [], error: null }))

    renderPage()

    expect(screen.getByText(COPY.emptyState.allClear.title)).toBeInTheDocument()
  })

  it('shows an honest error state — never all-clear — when the queue fails with zero items', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [], error: 'Network error' }))

    renderPage()

    expect(screen.queryByText(COPY.emptyState.allClear.title)).not.toBeInTheDocument()
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })

  it('keeps rows visible and shows a stale/retry banner on a background failure', () => {
    const refetch = vi.fn()
    mockedUseExceptionQueue.mockReturnValue(
      queueState({ items: [makeQueueItem()], error: 'Refresh failed', refetch }),
    )

    renderPage()

    expect(screen.getByText('Seal at destination does not match departure.')).toBeInTheDocument()
    expect(screen.getByText(/may be out of date/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows trip status and phase/stop context on a row, degrading cleanly when absent', () => {
    mockedUseExceptionQueue.mockReturnValue(
      queueState({
        items: [
          makeQueueItem({ id: 'exc-a' as TripExceptionListItem['id'], trip_status: 'exception_hold', phase_label: 'In Transit', stop_label: 2 }),
          makeQueueItem({ id: 'exc-b' as TripExceptionListItem['id'], trip_status: 'closed', phase_label: null, stop_label: null }),
        ],
      }),
    )

    renderPage()

    expect(screen.getByText('Exception')).toBeInTheDocument() // TRIP_STATUS_META.exception_hold.label
    expect(screen.getByText(/In Transit/)).toBeInTheDocument()
    expect(screen.getByText(/Stop 2/)).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument() // TRIP_STATUS_META.closed.label

    // Degrades cleanly for the null phase/stop row — no literal "null" text and no
    // dangling "· " fragment left over from a half-built label.
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^\s*·\s*$/)).not.toBeInTheDocument()
  })

  it('navigates to the exception detail route when a row is clicked', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [makeQueueItem({ id: 'exc-123' as TripExceptionListItem['id'] })] }))

    renderPage()

    fireEvent.click(screen.getByText('Seal at destination does not match departure.'))

    expect(push).toHaveBeenCalledWith('/exceptions/exc-123')
  })
})

describe('History tab', () => {
  it("reflects the hook's totalItems, distinct from items.length", () => {
    const items = Array.from({ length: 25 }, (_, i) => makeHistoryItem({ id: `exc-h${i}` as TripExceptionListItem['id'] }))
    mockedUseExceptionHistory.mockReturnValue(
      historyState({ items, totalItems: 137, page: 1, pageSize: 25, hasPrevious: false, hasNext: true }),
    )

    renderPage()
    goToHistoryTab()

    expect(screen.getByText('1–25 of 137')).toBeInTheDocument()
  })

  it('renders Pagination wired to the hook fields', () => {
    const items = Array.from({ length: 25 }, (_, i) => makeHistoryItem({ id: `exc-h${i}` as TripExceptionListItem['id'] }))
    mockedUseExceptionHistory.mockReturnValue(
      historyState({ items, totalItems: 137, page: 1, pageSize: 25, hasPrevious: false, hasNext: true }),
    )

    renderPage()
    goToHistoryTab()

    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    expect(screen.getByLabelText('Next page')).not.toBeDisabled()
  })

  it('shows a no-results empty state when history is empty with no error', () => {
    mockedUseExceptionHistory.mockReturnValue(historyState({ items: [], error: null }))

    renderPage()
    goToHistoryTab()

    expect(screen.getByText(COPY.emptyState.noResults.title)).toBeInTheDocument()
  })

  it('shows an honest error state — never no-results — when history fails with zero items', () => {
    mockedUseExceptionHistory.mockReturnValue(historyState({ items: [], error: 'Server error', isStale: true }))

    renderPage()
    goToHistoryTab()

    expect(screen.queryByText(COPY.emptyState.noResults.title)).not.toBeInTheDocument()
    expect(screen.getByText('Server error')).toBeInTheDocument()
  })

  it('keeps rows visible and shows a stale/retry banner when isStale is true', () => {
    const refetch = vi.fn()
    mockedUseExceptionHistory.mockReturnValue(
      historyState({ items: [makeHistoryItem()], isStale: true, refetch }),
    )

    renderPage()
    goToHistoryTab()

    expect(screen.getByText('Seal at destination does not match departure.')).toBeInTheDocument()
    expect(screen.getByText(/may be out of date/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('navigates to the exception detail route when a row is clicked', () => {
    mockedUseExceptionHistory.mockReturnValue(
      historyState({ items: [makeHistoryItem({ id: 'exc-h999' as TripExceptionListItem['id'] })] }),
    )

    renderPage()
    goToHistoryTab()

    fireEvent.click(screen.getByText('Seal at destination does not match departure.'))

    expect(push).toHaveBeenCalledWith('/exceptions/exc-h999')
  })

  it('calls useExceptionHistory with updated filters when the review-status select changes', () => {
    renderPage()
    goToHistoryTab()

    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'reviewed' } })

    const lastCall = mockedUseExceptionHistory.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({ reviewStatus: 'reviewed' })
  })

  it('calls useExceptionHistory with updated filters when the severity select changes', () => {
    renderPage()
    goToHistoryTab()

    fireEvent.change(screen.getByDisplayValue('All severities'), { target: { value: 'critical' } })

    const lastCall = mockedUseExceptionHistory.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({ severity: 'critical' })
  })

  it('calls useExceptionHistory with updated filters when the date range changes', () => {
    renderPage()
    goToHistoryTab()

    // The date inputs only exist once the picker's popover is open.
    fireEvent.click(screen.getByText(/→/))

    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs.length).toBeGreaterThanOrEqual(2)
    fireEvent.change(dateInputs[0], { target: { value: '2026-01-01' } })

    const lastCall = mockedUseExceptionHistory.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({ fromDate: '2026-01-01' })
  })

  it('debounces the search input — rapid keystrokes do not each trigger a distinct filters call', () => {
    vi.useFakeTimers()
    try {
      renderPage()
      goToHistoryTab()

      const searchInput = screen.getByPlaceholderText(/search/i)

      act(() => {
        fireEvent.change(searchInput, { target: { value: 'a' } })
        fireEvent.change(searchInput, { target: { value: 'ab' } })
        fireEvent.change(searchInput, { target: { value: 'abc' } })
      })

      // Before the debounce window elapses, no call should carry the fully-typed value.
      const callsBeforeSettle = mockedUseExceptionHistory.mock.calls.map(c => c[0]?.q)
      expect(callsBeforeSettle).not.toContain('abc')

      act(() => {
        vi.advanceTimersByTime(300)
      })

      const lastCall = mockedUseExceptionHistory.mock.calls.at(-1)?.[0]
      expect(lastCall).toMatchObject({ q: 'abc' })
    } finally {
      vi.useRealTimers()
    }
  })
})
