import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HistoryPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useTripHistory } from '@/lib/hooks/useTripHistory'
import type { UseTripHistoryResult } from '@/lib/hooks/useTripHistory'
import type { TripHistoryListItem } from '@shared/lib/types/trip'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/usePrecincts', () => ({
  usePrecincts: vi.fn(),
}))

vi.mock('@/lib/hooks/useTripHistory', () => ({
  useTripHistory: vi.fn(),
}))

const mockedUsePrecincts = vi.mocked(usePrecincts)
const mockedUseTripHistory = vi.mocked(useTripHistory)

function makeTrip(overrides: Partial<TripHistoryListItem> = {}): TripHistoryListItem {
  return {
    id: 'trip-1' as TripHistoryListItem['id'],
    trip_reference: 'FP-2026-0001',
    order_number: 'ORD-0001',
    status: 'closed',
    driver: { full_name: 'Nandi Dlamini' },
    horse: { registration: 'CA 123-456' },
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'destination-1',
    needs_review_count: 0,
    current_phase: 'confirmation',
    current_stop: 1,
    phase_total: 7,
    phase_completed: 7,
    closed_at: '2026-09-05T14:30:00Z',
    created_at: '2026-09-01T08:00:00Z',
    ...overrides,
  }
}

function historyState(overrides: Partial<UseTripHistoryResult> = {}): UseTripHistoryResult {
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
    hasNewHistory: false,
    goToNextPage: vi.fn(),
    goToPreviousPage: vi.fn(),
    refetch: vi.fn(),
    showNewHistory: vi.fn(),
    ...overrides,
  }
}

function renderPage() {
  return render(
    <ForensicModeProvider>
      <HistoryPage />
    </ForensicModeProvider>,
  )
}

beforeEach(() => {
  push.mockReset()
  mockedUseTripHistory.mockReset().mockReturnValue(historyState())
  mockedUsePrecincts.mockReset().mockReturnValue({
    precincts: [
      {
        id: 'origin-1' as never,
        name: 'Cape Town — Depot',
        principal_organization_id: 'org-1' as never,
        address: null,
        latitude: -33.9,
        longitude: 18.4,
        geofence_radius_metres: 100,
        is_shared: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'destination-1' as never,
        name: 'Johannesburg — Depot',
        principal_organization_id: 'org-1' as never,
        address: null,
        latitude: -26.2,
        longitude: 28.0,
        geofence_radius_metres: 100,
        is_shared: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
})

describe('Trip History page', () => {
  it('uses the server total and renders the trip closed_at date', () => {
    mockedUseTripHistory.mockReturnValue(historyState({
      items: [makeTrip()],
      totalItems: 137,
      hasNext: true,
    }))

    renderPage()

    expect(screen.getByText('137 closed trips')).toBeInTheDocument()
    expect(screen.getByText('CLOSED')).toBeInTheDocument()
    expect(screen.getByText('05 Sept')).toBeInTheDocument()
    expect(screen.queryByText('01 Sept')).not.toBeInTheDocument()
  })

  it('passes search, route, and date filters to the history hook', () => {
    renderPage()

    fireEvent.change(screen.getByPlaceholderText(/search trip id/i), {
      target: { value: 'Nandi' },
    })
    expect(mockedUseTripHistory.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'Nandi' })

    fireEvent.change(screen.getByDisplayValue('All routes'), {
      target: { value: 'origin-1' },
    })
    expect(mockedUseTripHistory.mock.calls.at(-1)?.[0]).toMatchObject({
      q: 'Nandi',
      precinctId: 'origin-1',
    })

    fireEvent.click(screen.getByText(/→/))
    const dateInputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-09-02' } })
    fireEvent.change(dateInputs[1], { target: { value: '2026-09-06' } })
    expect(mockedUseTripHistory.mock.calls.at(-1)?.[0]).toMatchObject({
      fromDate: '2026-09-02',
      toDate: '2026-09-06',
    })
  })

  it('uses the South African operations date before 02:00 SAST', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T22:30:00Z'))

    try {
      renderPage()

      expect(mockedUseTripHistory).toHaveBeenLastCalledWith(expect.objectContaining({
        fromDate: '2020-01-01',
        toDate: '2026-09-07',
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders shared pagination from server page state and wires navigation', () => {
    const goToNextPage = vi.fn()
    mockedUseTripHistory.mockReturnValue(historyState({
      items: [makeTrip()],
      totalItems: 40,
      page: 2,
      hasPrevious: true,
      hasNext: true,
      goToNextPage,
    }))

    renderPage()

    expect(screen.getByText('26–26 of 40')).toBeInTheDocument()
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(goToNextPage).toHaveBeenCalledTimes(1)
  })

  it('shows new history without disrupting the current page and wires its action', () => {
    const showNewHistory = vi.fn()
    mockedUseTripHistory.mockReturnValue(historyState({
      items: [makeTrip()],
      totalItems: 40,
      page: 2,
      hasPrevious: true,
      hasNewHistory: true,
      showNewHistory,
    }))

    renderPage()

    expect(screen.getByText('Page 2')).toBeInTheDocument()
    const notice = screen.getByRole('status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    fireEvent.click(screen.getByRole('button', { name: /new trip history available/i }))
    expect(showNewHistory).toHaveBeenCalledTimes(1)
  })

  it('keeps prior rows visible and marks them stale when a refresh fails', () => {
    const refetch = vi.fn()
    mockedUseTripHistory.mockReturnValue(historyState({
      items: [makeTrip()],
      totalItems: 1,
      error: 'Network unreachable',
      isStale: true,
      refetch,
    }))

    renderPage()

    expect(screen.getByText('FP-2026-0001')).toBeInTheDocument()
    expect(screen.getByText(/may be out of date/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe('History exceptions column', () => {
  it('never tells a dispatcher a trip has no exceptions', () => {
    // needs_review_count counts NEEDS_REVIEW rows only. A trip whose exceptions have all
    // been reviewed reaches zero here while its record still holds them, so the row used
    // to state "No exceptions" about a trip that opens to show two.
    mockedUseTripHistory.mockReturnValue(historyState({ items: [makeTrip({ needs_review_count: 0 })], totalItems: 1 }))

    renderPage()

    expect(screen.queryByText('No exceptions')).toBeNull()
    expect(screen.getByText('None need review')).toBeInTheDocument()
  })

  it('still leads with the count when something is owed', () => {
    mockedUseTripHistory.mockReturnValue(historyState({ items: [makeTrip({ needs_review_count: 2 })], totalItems: 1 }))

    renderPage()

    expect(screen.getByText(/2 exceptions/)).toBeInTheDocument()
  })
})
