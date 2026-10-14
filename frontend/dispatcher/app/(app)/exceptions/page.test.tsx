import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import ExceptionsPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useExceptionQueue } from '@/lib/hooks/useExceptions'
import { useExceptionHistory } from '@/lib/hooks/useExceptionHistory'
import type { UseExceptionQueueResult } from '@/lib/hooks/useExceptions'
import type { UseExceptionHistoryResult } from '@/lib/hooks/useExceptionHistory'
import type { TripExceptionListItem } from '@shared/lib/types/exception'

// client.ts imports the Supabase client at module scope, which throws without real env
// vars — mocked the same way the exceptions/[id] page test does.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// ForensicModeProvider (mounted via TopBar -> ForensicControls) reads the signed-in
// user. Nothing these tests assert depends on who that is, so identity is stubbed
// rather than standing up a real AuthProvider — same approach as the [id] page test.
const mockUser = vi.hoisted(() => ({ current: { id: 'me' } as { id: string } | null }))
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
    origin_name: 'Johannesburg DC',
    destination_name: 'Durban Depot',
    driver_name: 'Thabo Mokoena',
    horse_registration: 'HRS 001 GP',
    trailer_registrations: ['TRL 101 GP'],
    phase_label: 'In Transit',
    stop_label: 2,
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_name: null,
    reviewed_by_name: null,
    ...overrides,
  }
}

function makeHistoryItem(overrides: Partial<TripExceptionListItem> = {}): TripExceptionListItem {
  return {
    ...makeQueueItem(),
    id: 'exc-h1' as TripExceptionListItem['id'],
    review_status: 'recorded',
    trip_status: 'closed',
    origin_name: 'Johannesburg DC',
    destination_name: 'Durban Depot',
    driver_name: 'Thabo Mokoena',
    horse_registration: 'HRS 001 GP',
    trailer_registrations: ['TRL 101 GP'],
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_name: null,
    reviewed_by_name: null,
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

function mockMe() {
  mockUser.current = { id: 'me' }
}

function goToHistoryTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'History' }))
}

beforeEach(() => {
  mockMe()
  push.mockReset()
  mockedUseExceptionQueue.mockReset().mockReturnValue(queueState())
  mockedUseExceptionHistory.mockReset().mockReturnValue(historyState())
})

describe('Unreviewed tab', () => {
  it('reflects the unreviewed count in the tab label', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [makeQueueItem(), makeQueueItem({ id: 'exc-2' as TripExceptionListItem['id'] }), makeQueueItem({ id: 'exc-3' as TripExceptionListItem['id'] })] }))

    renderPage()

    expect(screen.getByRole('tab', { name: /^Unreviewed\s*3$/ })).toBeInTheDocument()
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

    expect(screen.getByText('No exceptions need review.')).toBeInTheDocument()
  })

  it('shows an honest error state — never all-clear — when the queue fails with zero items', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [], error: 'Network error' }))

    renderPage()

    expect(screen.queryByText('No exceptions need review.')).not.toBeInTheDocument()
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

    expect(screen.getByText(/In Transit/)).toBeInTheDocument()
    expect(screen.getByText(/Recorded stop 2/)).toBeInTheDocument()

    // Degrades cleanly for the null phase/stop row — no literal "null" text and no
    // dangling "· " fragment left over from a half-built label.
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^\s*·\s*$/)).not.toBeInTheDocument()
  })

  it('navigates to the exception detail route when a row is clicked', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [makeQueueItem({ id: 'exc-123' as TripExceptionListItem['id'] })] }))

    renderPage()

    expect(screen.getByRole('link', { name: /FP-2026-0001/ })).toHaveAttribute('href', '/exceptions/exc-123?returnTo=%2Fexceptions')
  })
})

describe('Claimed by me tab', () => {
  const claimedByMe = () => makeQueueItem({
    id: 'exc-mine' as TripExceptionListItem['id'],
    description: 'Mine row',
    claimed_by_user_id: 'me',
    claimed_by_name: 'Me',
  })
  const claimedByAna = () => makeQueueItem({
    id: 'exc-ana' as TripExceptionListItem['id'],
    description: 'Ana row',
    claimed_by_user_id: 'ana',
    claimed_by_name: 'Ana',
  })
  const unclaimed = () => makeQueueItem({
    id: 'exc-free' as TripExceptionListItem['id'],
    description: 'Free row',
  })

  it('lists every exception awaiting review in Unreviewed, including your own claims, and your claims again under Claimed by me', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [claimedByMe(), claimedByAna(), unclaimed()] }))

    renderPage()

    expect(screen.getByRole('tab', { name: /^Unreviewed\s*3$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Claimed by me\s*1$/ })).toBeInTheDocument()
    expect(screen.getByText('Claimed by Ana')).toBeInTheDocument()
    expect(screen.getByText('Claimed by you')).toBeInTheDocument()
    expect(screen.getByText('Mine row')).toBeInTheDocument()
    expect(screen.getByText('Free row')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /^Claimed by me\s*1$/ }))

    expect(screen.getByText('Mine row')).toBeInTheDocument()
    expect(screen.getByText('Claimed by you')).toBeInTheDocument()
    expect(screen.queryByText('Ana row')).not.toBeInTheDocument()
    expect(screen.queryByText('Free row')).not.toBeInTheDocument()
  })

  it('shows the claim hint when nothing is claimed by me', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [unclaimed()] }))

    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Claimed by me' }))

    expect(
      screen.getByText('Nothing claimed by you.'),
    ).toBeInTheDocument()
  })

  it('sorts newer warnings before older critical records', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({
      items: [
        makeQueueItem({ id: 'a' as TripExceptionListItem['id'], severity: 'critical', description: 'First critical', created_at: '2026-10-01T10:00:00Z' }),
        makeQueueItem({ id: 'b' as TripExceptionListItem['id'], severity: 'warning', description: 'Second warning', created_at: '2026-10-02T10:00:00Z' }),
        makeQueueItem({ id: 'c' as TripExceptionListItem['id'], severity: 'info', description: 'Third info' }),
      ],
    }))

    renderPage()

    const text = document.body.textContent ?? ''
    expect(text.indexOf('Second warning')).toBeLessThan(text.indexOf('First critical'))
    expect(text.indexOf('First critical')).toBeLessThan(text.indexOf('Third info'))
  })
})

describe('History tab', () => {
  it('shows the reviewer on the Reviewed tab', () => {
    mockedUseExceptionHistory.mockReturnValue(historyState({
      items: [makeHistoryItem({ review_status: 'reviewed', reviewed_by_name: 'Ben' })],
    }))

    renderPage()
    goToHistoryTab()

    expect(screen.getByText('Reviewed by Ben')).toBeInTheDocument()
  })

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

    expect(screen.getByText('No exception history yet.')).toBeInTheDocument()
  })

  it('shows an honest error state — never no-results — when history fails with zero items', () => {
    mockedUseExceptionHistory.mockReturnValue(historyState({ items: [], error: 'Server error', isStale: true }))

    renderPage()
    goToHistoryTab()

    expect(screen.queryByText('No exception history yet.')).not.toBeInTheDocument()
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

    expect(screen.getByRole('link', { name: /FP-2026-0001/ })).toHaveAttribute('href', '/exceptions/exc-h999?returnTo=%2Fexceptions%3Ftab%3Dhistory')
  })

  it('keeps legacy archive inclusion without a redundant status filter', () => {
    renderPage(); goToHistoryTab()
    expect(screen.queryByDisplayValue('All statuses')).not.toBeInTheDocument()
    expect(mockedUseExceptionHistory.mock.calls.at(-1)?.[0].reviewStatus).toBeUndefined()
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

    // The date inputs live in the shared range picker's popover.
    fireEvent.click(screen.getByRole('button', { name: /→/ }))
    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs).toHaveLength(2)
    fireEvent.change(dateInputs[0], { target: { value: '2026-01-01' } })

    const lastCall = mockedUseExceptionHistory.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({ fromDate: '2026-01-01' })
  })

  it('sends no date filter while the picker still shows its full default range', () => {
    renderPage()
    goToHistoryTab()

    const lastCall = mockedUseExceptionHistory.mock.calls.at(-1)?.[0]
    expect(lastCall?.fromDate).toBeUndefined()
    expect(lastCall?.toDate).toBeUndefined()
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

describe('redesign controls', () => {
  it('shows full identifiers, absolute SAST time and readable raw context', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({items:[makeQueueItem({trip_reference:'FP-2026-LONG-FULL-32FF7346',phase_label:'in_transit',stop_label:0,created_at:'2026-10-01T22:00:00Z'})]}))
    renderPage()
    expect(screen.getByText('FP-2026-LONG-FULL-32FF7346')).toBeVisible()
    expect(screen.getByText('02 Oct 2026')).toBeVisible()
    expect(screen.getByText('00:00 SAST')).toBeVisible()
    expect(screen.getByText(/Recorded stop 0/)).not.toHaveTextContent('in_transit')
  })
  it('filters the complete queue without reducing tab counts and explains filtered emptiness', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({items:[makeQueueItem()]}))
    renderPage()
    fireEvent.change(screen.getByLabelText('Severity'),{target:{value:'warning'}})
    expect(screen.getByRole('tab',{name: /^Unreviewed\s*1$/})).toBeInTheDocument()
    expect(screen.getByText('No exceptions match these filters.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button',{name:'Clear filters'})[0])
    expect(screen.getByText('Seal at destination does not match departure.')).toBeInTheDocument()
  })
  it('shows route, driver and vehicles on every row under column headings', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({items:[makeQueueItem()]}))
    renderPage()
    for (const heading of ['Incident','Trip & route','Driver & vehicles','Status']) expect(screen.getByRole('columnheader',{name:heading})).toBeInTheDocument()
    expect(screen.getByRole('columnheader',{name:/Raised/})).toBeInTheDocument()
    expect(screen.getByText('Johannesburg DC → Durban Depot')).toBeInTheDocument()
    expect(screen.getByText('Thabo Mokoena')).toBeInTheDocument()
    expect(screen.getByText('HRS 001 GP + TRL 101 GP')).toBeInTheDocument()
  })
  it('supports keyboard tabs and optional groups while retaining child trip references', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({items:[makeQueueItem(),makeQueueItem({id:'other' as TripExceptionListItem['id'],trip_id:'other-trip',trip_reference:'FP-OTHER',severity:'warning'})]}))
    renderPage()
    expect(screen.queryByRole('button',{name:/Newest ·/})).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Group by'),{target:{value:'trip'}})
    expect(screen.getByRole('button',{name:/Trip FP-2026-0001/})).toHaveAttribute('aria-expanded','true')
    expect(screen.getByText('Trip FP-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('FP-2026-0001')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Group by'),{target:{value:'none'}})
    expect(screen.queryByRole('button',{name:/Newest ·/})).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('tab',{name: /^Unreviewed\s*2$/}),{key:'ArrowLeft'})
    expect(screen.getByRole('tab',{name:'History'})).toHaveFocus()
  })
})

describe('sortable headers', () => {
  const trip = (id: string, reference: string, created: string) => makeQueueItem({ id: id as TripExceptionListItem['id'], trip_reference: reference, description: `Item ${id}.`, created_at: created })
  const order = () => screen.getAllByRole('row').slice(1).map(row => /Item (\w+)/.exec(row.textContent ?? '')?.[1])

  beforeEach(() => {
    mockedUseExceptionQueue.mockReturnValue(queueState({
      items: [trip('a', 'FP-2', '2026-10-01T10:00:00Z'), trip('b', 'FP-3', '2026-10-02T10:00:00Z'), trip('c', 'FP-1', '2026-10-03T10:00:00Z')],
    }))
  })

  it('starts newest first and reorders by the clicked column, flipping on a second click', () => {
    renderPage()
    expect(order()).toEqual(['c', 'b', 'a'])

    fireEvent.click(screen.getByRole('button', { name: 'Trip & route' }))
    expect(order()).toEqual(['c', 'a', 'b'])
    expect(screen.getByRole('columnheader', { name: 'Trip & route' })).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(screen.getByRole('button', { name: 'Trip & route' }))
    expect(order()).toEqual(['b', 'a', 'c'])
  })

  it('does not offer sorting on History, whose order the server owns', () => {
    mockedUseExceptionHistory.mockReturnValue(historyState({ items: [makeHistoryItem()] }))
    renderPage()
    goToHistoryTab()

    expect(screen.queryByRole('button', { name: 'Trip & route' })).toBeNull()
  })

  it('does not offer sorting while grouped by trip', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'trip' } })

    expect(screen.queryByRole('button', { name: 'Trip & route' })).toBeNull()
  })
})

describe('claim status', () => {
  const claimed = (overrides: Partial<TripExceptionListItem> = {}) => makeQueueItem({
    claimed_by_user_id: 'u-tim', claimed_by_name: 'Tim Gultig', claimed_at: new Date(Date.now() - 2 * 60_000).toISOString(), ...overrides,
  })

  it("shows a colleague's name, how long ago they claimed it, and offers to take over", () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [claimed()] }))
    renderPage()

    expect(screen.getByText('Claimed by Tim Gultig')).toBeInTheDocument()
    expect(screen.getByText('2 min ago')).toBeInTheDocument()
    expect(screen.getByText('Take over')).toBeInTheDocument()
  })

  it('shows plain Unclaimed and Review for an exception nobody holds', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [makeQueueItem()] }))
    renderPage()

    expect(screen.getByText('Unclaimed')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
  })

  it('announces and flashes a row when a colleague claims it after the list loaded', () => {
    const unclaimed = makeQueueItem()
    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [unclaimed] }))
    const { rerender } = renderPage()

    mockedUseExceptionQueue.mockReturnValue(queueState({ items: [claimed()] }))
    rerender(<ForensicModeProvider><ExceptionsPage /></ForensicModeProvider>)

    expect(screen.getByText('Tim Gultig claimed Seal Mismatch')).toBeInTheDocument()
    expect(screen.getByText('Claimed by Tim Gultig').closest('tr')).toHaveClass('bg-sec-c/50')
  })
})

describe('loading state', () => {
  it('shows the table header over skeleton rows on the first load, with no count and no spinner block', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ isLoading: true }))
    renderPage()

    expect(screen.getByRole('columnheader', { name: 'Incident' })).toBeInTheDocument()
    expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('tbody .animate-pulse').length).toBeGreaterThan(0)
    expect(screen.getByText('Loading exceptions', { selector: '[role="status"]' })).toBeInTheDocument()
    expect(screen.queryByText(/^Showing /)).toBeNull()
    expect(screen.queryByText('No exceptions need review.')).toBeNull()
  })

  it('keeps showing rows, never skeletons, when a refresh runs while data is already on screen', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ isLoading: true, items: [makeQueueItem()] }))
    renderPage()

    expect(screen.getByText('Seal at destination does not match departure.')).toBeInTheDocument()
    expect(document.querySelectorAll('tbody .animate-pulse')).toHaveLength(0)
  })

  it('shows skeletons on the History tab too, without pagination controls', () => {
    mockedUseExceptionHistory.mockReturnValue(historyState({ isLoading: true }))
    renderPage()
    goToHistoryTab()

    expect(screen.getByText('Loading exception history', { selector: '[role="status"]' })).toBeInTheDocument()
    expect(document.querySelectorAll('tbody .animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull()
  })

  it('still shows the error state, not skeletons, when the first load fails', () => {
    mockedUseExceptionQueue.mockReturnValue(queueState({ error: 'boom' }))
    renderPage()

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(document.querySelectorAll('tbody .animate-pulse')).toHaveLength(0)
  })
})

