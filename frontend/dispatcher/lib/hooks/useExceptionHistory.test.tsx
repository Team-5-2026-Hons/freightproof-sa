import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useExceptionHistory } from './useExceptionHistory'
import { api } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { ExceptionSeverity, TripExceptionListItem } from '@shared/lib/types/exception'
import type { CursorPage } from '@shared/lib/types/pagination'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

// History is a browsable archive, not a live queue — it must never subscribe.
vi.mock('@/lib/realtime/useLiveResource', () => ({
  useLiveResource: vi.fn(),
}))

const mockedGet = vi.mocked(api.get)
const mockedUseLiveResource = vi.mocked(useLiveResource)

function makeItem(overrides: Partial<TripExceptionListItem> = {}): TripExceptionListItem {
  return {
    id: '11111111-1111-1111-1111-111111111111' as TripExceptionListItem['id'],
    exception_type: 'seal_mismatch',
    source: 'system',
    severity: 'critical',
    review_status: 'reviewed',
    description: 'Seal at destination does not match departure.',
    created_at: '2026-09-03T10:00:00Z',
    trip_id: '22222222-2222-2222-2222-222222222222',
    trip_reference: 'FP-2026-0001',
    trip_status: 'closed',
    phase_label: 'in_transit',
    stop_label: 1,
    ...overrides,
  }
}

function makePage(
  overrides: Partial<CursorPage<TripExceptionListItem>> = {},
): CursorPage<TripExceptionListItem> {
  return {
    items: [makeItem()],
    next_cursor: null,
    total_items: 1,
    ...overrides,
  }
}

// A promise plus the functions to settle it later, so a test can control the ORDER in
// which two overlapping requests resolve (out-of-order resolution is the whole point of
// the stale-response test below).
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
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

describe('useExceptionHistory', () => {
  it('fetches the history endpoint with only limit=25 on initial mount', async () => {
    mockedGet.mockResolvedValue(makePage())

    renderHook(() => useExceptionHistory({}))

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/exceptions/history?limit=25')
    expect(mockedGet).toHaveBeenCalledTimes(1)
  })

  it('URL-encodes every filter into the query string when provided', async () => {
    mockedGet.mockResolvedValue(makePage())

    renderHook(() => useExceptionHistory({
      q: 'seal & smoke',
      reviewStatus: 'reviewed',
      severity: 'critical',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    }))

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    const calledPath = mockedGet.mock.calls[0][0] as string
    const [base, queryString] = calledPath.split('?')
    expect(base).toBe('/api/v1/exceptions/history')
    const params = new URLSearchParams(queryString)
    expect(params.get('limit')).toBe('25')
    expect(params.get('q')).toBe('seal & smoke')
    expect(params.get('review_status')).toBe('reviewed')
    expect(params.get('severity')).toBe('critical')
    expect(params.get('from_date')).toBe('2026-01-01')
    expect(params.get('to_date')).toBe('2026-01-31')
  })

  it('sends the previous next_cursor on goToNextPage and updates paging state', async () => {
    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: 'cursor-page-2', total_items: 2 }))

    const { result } = renderHook(() => useExceptionHistory({}))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.page).toBe(1)
    expect(result.current.hasPrevious).toBe(false)
    expect(result.current.hasNext).toBe(true)

    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: null, total_items: 2 }))

    act(() => result.current.goToNextPage())

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2))
    const secondCallPath = mockedGet.mock.calls[1][0] as string
    expect(new URLSearchParams(secondCallPath.split('?')[1]).get('cursor')).toBe('cursor-page-2')

    await waitFor(() => expect(result.current.page).toBe(2))
    expect(result.current.hasPrevious).toBe(true)
    expect(result.current.hasNext).toBe(false)
  })

  it('goToPreviousPage returns to page 1 by re-requesting without a cursor param', async () => {
    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: 'cursor-page-2' }))
    const { result } = renderHook(() => useExceptionHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: null }))
    act(() => result.current.goToNextPage())
    await waitFor(() => expect(result.current.page).toBe(2))

    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: 'cursor-page-2' }))
    act(() => result.current.goToPreviousPage())

    await waitFor(() => expect(result.current.page).toBe(1))
    const lastCallPath = mockedGet.mock.calls[mockedGet.mock.calls.length - 1][0] as string
    expect(lastCallPath).toBe('/api/v1/exceptions/history?limit=25')
  })

  it('does nothing when goToNextPage is called with hasNext false', async () => {
    mockedGet.mockResolvedValue(makePage({ next_cursor: null }))
    const { result } = renderHook(() => useExceptionHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.hasNext).toBe(false)
    const callsBefore = mockedGet.mock.calls.length

    act(() => result.current.goToNextPage())

    expect(mockedGet.mock.calls.length).toBe(callsBefore)
    expect(result.current.page).toBe(1)
  })

  it('resets to page 1 with no cursor param when a filter changes', async () => {
    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: 'cursor-page-2' }))
    const { result, rerender } = renderHook(
      (props: { severity: ExceptionSeverity }) => useExceptionHistory(props),
      { initialProps: { severity: 'critical' } },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: null }))
    act(() => result.current.goToNextPage())
    await waitFor(() => expect(result.current.page).toBe(2))

    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: null }))
    rerender({ severity: 'warning' })

    await waitFor(() => expect(result.current.page).toBe(1))
    const lastCallPath = mockedGet.mock.calls[mockedGet.mock.calls.length - 1][0] as string
    const params = new URLSearchParams(lastCallPath.split('?')[1])
    expect(params.get('cursor')).toBeNull()
    expect(params.get('severity')).toBe('warning')
  })

  it('never lets a late older response overwrite a newer filter-changed response', async () => {
    const first = deferred<CursorPage<TripExceptionListItem>>()
    const second = deferred<CursorPage<TripExceptionListItem>>()
    mockedGet.mockReturnValueOnce(first.promise)

    const { result, rerender } = renderHook(
      (props: { severity: ExceptionSeverity }) => useExceptionHistory(props),
      { initialProps: { severity: 'critical' } },
    )
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))

    mockedGet.mockReturnValueOnce(second.promise)
    rerender({ severity: 'warning' })
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2))

    // Resolve the NEWER request first, then the OLDER one — the older result must be
    // discarded even though it settles last.
    second.resolve(makePage({
      items: [makeItem({ id: 'newer' as TripExceptionListItem['id'] })],
      total_items: 99,
    }))
    await waitFor(() => expect(result.current.totalItems).toBe(99))

    first.resolve(makePage({
      items: [makeItem({ id: 'older' as TripExceptionListItem['id'] })],
      total_items: 1,
    }))

    // Give the stale promise a tick to (wrongly) apply, then assert it did not.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.totalItems).toBe(99)
    expect(result.current.items.map(i => i.id)).toEqual(['newer'])
  })

  it('keeps prior rows on a failed fetch, sets isStale, and clears it on a successful refetch', async () => {
    mockedGet.mockResolvedValueOnce(makePage({ total_items: 5 }))
    const { result } = renderHook(() => useExceptionHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isStale).toBe(false)

    mockedGet.mockRejectedValueOnce(new Error('Network unreachable'))
    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.error).toBe('Network unreachable'))
    expect(result.current.isStale).toBe(true)
    expect(result.current.totalItems).toBe(5)
    expect(result.current.items).toHaveLength(1)

    mockedGet.mockResolvedValueOnce(makePage({ total_items: 7, items: [makeItem(), makeItem({ id: 'x' as TripExceptionListItem['id'] })] }))
    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.isStale).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.totalItems).toBe(7)
  })

  it('clears the previous query when a filter-changed request fails', async () => {
    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: 'old-cursor', total_items: 5 }))
    const { result, rerender } = renderHook(
      (props: { severity: ExceptionSeverity }) => useExceptionHistory(props),
      { initialProps: { severity: 'critical' } },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mockedGet.mockRejectedValueOnce(new Error('Network unreachable'))
    rerender({ severity: 'warning' })

    await waitFor(() => expect(result.current.error).toBe('Network unreachable'))
    expect(result.current.items).toEqual([])
    expect(result.current.totalItems).toBe(0)
    expect(result.current.hasNext).toBe(false)
    expect(result.current.isStale).toBe(false)
  })

  it('clears the previous page and its next cursor when page navigation fails', async () => {
    mockedGet.mockResolvedValueOnce(makePage({ next_cursor: 'cursor-page-2', total_items: 5 }))
    const { result } = renderHook(() => useExceptionHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mockedGet.mockRejectedValueOnce(new Error('Network unreachable'))
    act(() => result.current.goToNextPage())

    await waitFor(() => expect(result.current.error).toBe('Network unreachable'))
    expect(result.current.page).toBe(2)
    expect(result.current.items).toEqual([])
    expect(result.current.totalItems).toBe(0)
    expect(result.current.hasNext).toBe(false)
    expect(result.current.isStale).toBe(false)
  })

  it('always reports pageSize 25 regardless of a short last page', async () => {
    mockedGet.mockResolvedValue(makePage({ items: [makeItem()], total_items: 1, next_cursor: null }))
    const { result } = renderHook(() => useExceptionHistory({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.pageSize).toBe(25)
  })

  it('never subscribes to useLiveResource', async () => {
    mockedGet.mockResolvedValue(makePage())
    renderHook(() => useExceptionHistory({}))
    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    expect(mockedUseLiveResource).not.toHaveBeenCalled()
  })
})
