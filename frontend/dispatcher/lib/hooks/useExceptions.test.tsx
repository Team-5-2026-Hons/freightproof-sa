import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useExceptionQueue } from './useExceptions'
import { api } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { TripExceptionListItem } from '@shared/lib/types/exception'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

// The hook subscribes to the live channel; the provider is not mounted in these tests
// and its absence must not be what the assertions are measuring.
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
    review_status: 'needs_review',
    description: 'Seal at destination does not match departure.',
    created_at: '2026-09-03T10:00:00Z',
    trip_id: '22222222-2222-2222-2222-222222222222',
    trip_reference: 'FP-2026-0001',
    trip_status: 'active',
    phase_label: 'in_transit',
    stop_label: 1,
    ...overrides,
  }
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedUseLiveResource.mockReset()
})

describe('useExceptionQueue', () => {
  it('returns the fetched items and no error on success', async () => {
    mockedGet.mockResolvedValue([makeItem()])

    const { result } = renderHook(() => useExceptionQueue())

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it('surfaces a fetch failure instead of returning an empty list', async () => {
    // The defect this shape exists to prevent. An exception queue that failed to load
    // is indistinguishable from one that is genuinely empty, and "no exceptions" is the
    // most reassuring thing this screen can say — saying it because a request failed is
    // the worst error the page can make.
    mockedGet.mockRejectedValue(new Error('Network unreachable'))

    const { result } = renderHook(() => useExceptionQueue())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('Network unreachable')
    expect(result.current.items).toEqual([])
  })

  it('fetches the review-queue endpoint only, with no query string', async () => {
    mockedGet.mockResolvedValue([])

    renderHook(() => useExceptionQueue())

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/exceptions/review-queue')
    expect(mockedGet).toHaveBeenCalledTimes(1)
  })

  it('subscribes to trip exception events via useLiveResource', async () => {
    mockedGet.mockResolvedValue([])

    renderHook(() => useExceptionQueue())

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(mockedUseLiveResource).toHaveBeenCalledWith(
      'trip',
      'any',
      expect.any(Function),
      { kinds: ['exception_raised', 'exception_reviewed'] },
    )
  })
})
