import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { CursorPage } from '@shared/lib/types/pagination'
import type { TripHistoryListItem } from '@shared/lib/types/trip'
import { useTripHistory } from './useTripHistory'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/lib/realtime/useLiveResource', () => ({
  useLiveResource: vi.fn(),
}))

const mockedGet = vi.mocked(api.get)
const mockedUseLiveResource = vi.mocked(useLiveResource)

function makeItem(overrides: Partial<TripHistoryListItem> = {}): TripHistoryListItem {
  return {
    id: '11111111-1111-1111-1111-111111111111' as TripHistoryListItem['id'],
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

function makePage(
  overrides: Partial<CursorPage<TripHistoryListItem>> = {},
): CursorPage<TripHistoryListItem> {
  return {
    items: [makeItem()],
    next_cursor: null,
    total_items: 1,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedUseLiveResource.mockReset()
})

describe('useTripHistory', () => {
  it('encodes the supported server filters and fixed page size', async () => {
    mockedGet.mockResolvedValue(makePage())

    renderHook(() => useTripHistory({
      q: 'Nandi & ORD',
      precinctId: 'precinct/one',
      fromDate: '2026-09-01',
      toDate: '2026-09-05',
    }))

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/trips/history?limit=25&q=Nandi+%26+ORD&precinct_id=precinct%2Fone&from_date=2026-09-01&to_date=2026-09-05',
    )
  })

  it('records server cursors when moving forward and reuses them when moving back', async () => {
    mockedGet
      .mockResolvedValueOnce(makePage({ next_cursor: 'cursor-2', total_items: 51 }))
      .mockResolvedValueOnce(makePage({ next_cursor: 'cursor-3', total_items: 51 }))
      .mockResolvedValueOnce(makePage({ next_cursor: 'cursor-2', total_items: 51 }))

    const { result } = renderHook(() => useTripHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.goToNextPage())
    await waitFor(() => expect(result.current.page).toBe(2))
    expect(mockedGet).toHaveBeenLastCalledWith(
      '/api/v1/trips/history?limit=25&cursor=cursor-2',
    )

    act(() => result.current.goToPreviousPage())
    await waitFor(() => expect(result.current.page).toBe(1))
    expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/trips/history?limit=25')
  })

  it('resets to page one immediately when a route or date filter changes', async () => {
    mockedGet.mockResolvedValue(makePage({ next_cursor: 'cursor-2', total_items: 40 }))
    const { result, rerender } = renderHook(
      ({ precinctId, fromDate }) => useTripHistory({ precinctId, fromDate }),
      { initialProps: { precinctId: '', fromDate: '2026-09-01' } },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.goToNextPage())
    await waitFor(() => expect(result.current.page).toBe(2))

    rerender({ precinctId: 'precinct-2', fromDate: '2026-09-02' })

    expect(result.current.page).toBe(1)
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith(
      '/api/v1/trips/history?limit=25&precinct_id=precinct-2&from_date=2026-09-02',
    ))
  })

  it('does not retain page-one rows when loading page two fails', async () => {
    mockedGet
      .mockResolvedValueOnce(makePage({
        items: [makeItem({ order_number: 'PAGE-ONE' })],
        next_cursor: 'cursor-2',
        total_items: 40,
      }))
      .mockRejectedValueOnce(new Error('Page two unavailable'))

    const { result } = renderHook(() => useTripHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.goToNextPage())

    await waitFor(() => expect(result.current.error).toBe('Page two unavailable'))
    expect(result.current.page).toBe(2)
    expect(result.current.items).toEqual([])
    expect(result.current.totalItems).toBe(0)
    expect(result.current.isStale).toBe(false)
  })

  it('does not retain rows from the previous filters when changed-filter loading fails', async () => {
    mockedGet
      .mockResolvedValueOnce(makePage({
        items: [makeItem({ order_number: 'OLD-FILTER' })],
        total_items: 1,
      }))
      .mockRejectedValueOnce(new Error('Filtered history unavailable'))

    const { result, rerender } = renderHook(
      ({ precinctId }) => useTripHistory({ precinctId }),
      { initialProps: { precinctId: 'old' } },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    rerender({ precinctId: 'new' })

    await waitFor(() => expect(result.current.error).toBe('Filtered history unavailable'))
    expect(result.current.page).toBe(1)
    expect(result.current.items).toEqual([])
    expect(result.current.totalItems).toBe(0)
    expect(result.current.isStale).toBe(false)
  })

  it('debounces text search before resetting and querying page one', async () => {
    vi.useFakeTimers()
    try {
      mockedGet.mockResolvedValue(makePage({ next_cursor: 'cursor-2' }))
      const { result, rerender } = renderHook(
        ({ q }) => useTripHistory({ q }),
        { initialProps: { q: '' } },
      )
      await act(async () => { await vi.runAllTimersAsync() })

      act(() => result.current.goToNextPage())
      await act(async () => { await Promise.resolve() })
      expect(result.current.page).toBe(2)

      rerender({ q: 'FP-2026' })
      expect(result.current.page).toBe(2)
      expect(mockedGet).toHaveBeenCalledTimes(2)

      await act(async () => { await vi.advanceTimersByTimeAsync(300) })

      expect(result.current.page).toBe(1)
      expect(mockedGet).toHaveBeenLastCalledWith(
        '/api/v1/trips/history?limit=25&q=FP-2026',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let a superseded response overwrite a newer filter response', async () => {
    const older = deferred<CursorPage<TripHistoryListItem>>()
    const newer = deferred<CursorPage<TripHistoryListItem>>()
    mockedGet.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

    const { result, rerender } = renderHook(
      ({ precinctId }) => useTripHistory({ precinctId }),
      { initialProps: { precinctId: 'old' } },
    )
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))

    rerender({ precinctId: 'new' })
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2))

    await act(async () => {
      newer.resolve(makePage({ total_items: 9, items: [makeItem({ order_number: 'NEW' })] }))
      await newer.promise
    })
    await waitFor(() => expect(result.current.totalItems).toBe(9))

    await act(async () => {
      older.resolve(makePage({ total_items: 99, items: [makeItem({ order_number: 'OLD' })] }))
      await older.promise
    })

    expect(result.current.totalItems).toBe(9)
    expect(result.current.items[0]?.order_number).toBe('NEW')
  })

  it('silently refreshes page one for trip_closed events only', async () => {
    mockedGet.mockResolvedValue(makePage())
    const { result } = renderHook(() => useTripHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(mockedUseLiveResource).toHaveBeenCalledWith(
      'trip',
      'any',
      expect.any(Function),
      { kinds: ['trip_closed'] },
    )
    const onTripClosed = mockedUseLiveResource.mock.calls.at(-1)?.[2]
    expect(onTripClosed).toBeDefined()

    act(() => onTripClosed?.())

    expect(result.current.isLoading).toBe(false)
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2))
    expect(result.current.hasNewHistory).toBe(false)
  })

  it('keeps a later page stable until the new-history action returns to page one', async () => {
    mockedGet.mockResolvedValue(makePage({ next_cursor: 'cursor-2', total_items: 40 }))
    const { result } = renderHook(() => useTripHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.goToNextPage())
    await waitFor(() => expect(result.current.page).toBe(2))
    const requestCount = mockedGet.mock.calls.length
    const onTripClosed = mockedUseLiveResource.mock.calls.at(-1)?.[2]

    act(() => onTripClosed?.())

    expect(result.current.page).toBe(2)
    expect(result.current.hasNewHistory).toBe(true)
    expect(mockedGet).toHaveBeenCalledTimes(requestCount)

    act(() => result.current.showNewHistory())

    expect(result.current.page).toBe(1)
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(requestCount + 1))
    expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/trips/history?limit=25')
    expect(result.current.hasNewHistory).toBe(false)
  })

  it('clears the new-history notice after Pagination returns successfully to page one', async () => {
    mockedGet.mockResolvedValue(makePage({ next_cursor: 'cursor-2', total_items: 40 }))
    const { result } = renderHook(() => useTripHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.goToNextPage())
    await waitFor(() => expect(result.current.page).toBe(2))
    const onTripClosed = mockedUseLiveResource.mock.calls.at(-1)?.[2]
    act(() => onTripClosed?.())
    expect(result.current.hasNewHistory).toBe(true)

    act(() => result.current.goToPreviousPage())

    await waitFor(() => expect(result.current.page).toBe(1))
    await waitFor(() => expect(result.current.hasNewHistory).toBe(false))
  })
})
