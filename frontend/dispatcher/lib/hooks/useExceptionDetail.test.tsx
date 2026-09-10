import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useExceptionDetail } from './useExceptionDetail'
import { api } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { TripExceptionDetail } from '@shared/lib/types/exception'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/lib/realtime/useLiveResource', () => ({
  useLiveResource: vi.fn(),
}))

const mockedGet = vi.mocked(api.get)
const mockedUseLiveResource = vi.mocked(useLiveResource)

function makeDetail(overrides: Partial<TripExceptionDetail> = {}): TripExceptionDetail {
  return {
    id: '11111111-1111-1111-1111-111111111111' as TripExceptionDetail['id'],
    exception_type: 'seal_mismatch',
    source: 'system',
    severity: 'critical',
    review_status: 'needs_review',
    description: 'Seal at destination does not match departure.',
    created_at: '2026-09-03T10:00:00Z',
    trip_id: '33333333-3333-3333-3333-333333333333',
    trip_reference: 'FP-2026-0001',
    trip_status: 'active',
    phase_label: 'in_transit',
    stop_label: 1,
    gps_lat: null,
    gps_lng: null,
    review_outcome: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_note: null,
    contact_method: null,
    trip_closed_at: null,
    supporting_artifact_id: null,
    supporting_artifact: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedUseLiveResource.mockReset()
})

describe('useExceptionDetail', () => {
  it('fetches the exception by id and returns the detail record', async () => {
    const detail = makeDetail()
    mockedGet.mockResolvedValue(detail)

    const { result } = renderHook(() => useExceptionDetail('11111111-1111-1111-1111-111111111111'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/exceptions/11111111-1111-1111-1111-111111111111')
    expect(result.current.exception).toEqual(detail)
    expect(result.current.error).toBeNull()
  })

  it('surfaces a fetch failure as error', async () => {
    mockedGet.mockRejectedValue(new Error('Not found'))

    const { result } = renderHook(() => useExceptionDetail('some-id'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('Not found')
    expect(result.current.exception).toBeNull()
  })

  it('works independently given just an id, with no prior queue/history state', async () => {
    mockedGet.mockResolvedValue(makeDetail())

    const { result } = renderHook(() => useExceptionDetail('fresh-id'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(result.current.exception).not.toBeNull()
  })

  it('subscribes to the trip realtime channel, keyed by the loaded trip_id, filtered to exception kinds', async () => {
    const detail = makeDetail({ trip_id: 'trip-xyz' })
    mockedGet.mockResolvedValue(detail)

    renderHook(() => useExceptionDetail('11111111-1111-1111-1111-111111111111'))

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    // Before the fetch resolves, useLiveResource is called with id '' — but the
    // assertion that matters is the LATEST call, once trip_id is known.
    await waitFor(() => {
      const lastCall = mockedUseLiveResource.mock.calls[mockedUseLiveResource.mock.calls.length - 1]
      expect(lastCall).toEqual([
        'trip',
        'trip-xyz',
        expect.any(Function),
        { kinds: ['exception_raised', 'exception_reviewed'] },
      ])
    })
  })
})
