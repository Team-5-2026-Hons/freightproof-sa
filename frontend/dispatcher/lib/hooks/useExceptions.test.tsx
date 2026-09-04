import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveException, useExceptions } from './useExceptions'
import { api } from '@/lib/api/client'
import type { TripException } from '@shared/lib/types/exception'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}))

// The hook subscribes to the live channel; the provider is not mounted in these tests
// and its absence must not be what the assertions are measuring.
vi.mock('@/lib/realtime/useLiveResource', () => ({
  useLiveResource: vi.fn(),
}))

const mockedGet = vi.mocked(api.get)
const mockedPatch = vi.mocked(api.patch)

function makeException(overrides: Partial<TripException> = {}): TripException {
  return {
    id: '11111111-1111-1111-1111-111111111111' as TripException['id'],
    trip_id: '22222222-2222-2222-2222-222222222222',
    trip_reference: 'FP-2026-0001',
    exception_type: 'seal_mismatch',
    source: 'system',
    severity: 'critical',
    description: 'Seal at destination does not match departure.',
    phase_event_id: null,
    checkpoint_id: null,
    supporting_artifact_id: null,
    resolved: false,
    resolved_by_user_id: null,
    resolved_at: null,
    resolver_note: null,
    resolution_method: null,
    merkle_batch_id: null,
    created_at: '2026-09-03T10:00:00Z',
    updated_at: '2026-09-03T10:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPatch.mockReset()
})

describe('useExceptions', () => {
  it('returns the fetched exceptions and no error on success', async () => {
    mockedGet.mockResolvedValue([makeException()])

    const { result } = renderHook(() => useExceptions())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.exceptions).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it('surfaces a fetch failure instead of returning an empty list', async () => {
    // The defect this shape exists to prevent. An exception queue that failed to load
    // is indistinguishable from one that is genuinely empty, and "no exceptions" is the
    // most reassuring thing this screen can say — saying it because a request failed is
    // the worst error the page can make.
    mockedGet.mockRejectedValue(new Error('Network unreachable'))

    const { result } = renderHook(() => useExceptions())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('Network unreachable')
    expect(result.current.exceptions).toEqual([])
  })

  it('omits the query string entirely when no resolved filter is given', async () => {
    // Omitted must not collapse to `?resolved=false`: the detail page opens an exception
    // by permalink without knowing its state, and an unresolved-only default would make
    // a resolved exception unreachable from its own URL.
    mockedGet.mockResolvedValue([])

    renderHook(() => useExceptions())

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/exceptions')
  })

  it('always fetches the whole unfiltered list', async () => {
    // The hook takes no arguments: both screens want every exception. The endpoint still
    // supports ?resolved=, but nothing passes it, and the filter that used to live here
    // could never refetch once mounted (useAsyncData holds fetchFn in a ref).
    mockedGet.mockResolvedValue([])

    const { rerender } = renderHook(() => useExceptions())
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))

    rerender()

    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/exceptions')
  })

  it('returns every row it was given, unfiltered', async () => {
    // No client-side trip filter any more. The trip detail page reads its exceptions off
    // the trip response, not through this hook.
    const a = makeException({ trip_id: 'trip-a' })
    const b = makeException({
      id: '33333333-3333-3333-3333-333333333333' as TripException['id'],
      trip_id: 'trip-b',
    })
    mockedGet.mockResolvedValue([a, b])

    const { result } = renderHook(() => useExceptions())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.exceptions.map(e => e.trip_id)).toEqual(['trip-a', 'trip-b'])
    expect(mockedGet).toHaveBeenCalledTimes(1)
  })
})

describe('resolveException', () => {
  it('sends only the note and the method', async () => {
    // The server takes the resolver from the token and the timestamp from its own clock.
    // If the client ever started sending them the backend would ignore them, but sending
    // them at all would imply they are the client's to decide.
    mockedPatch.mockResolvedValue(makeException({ resolved: true }))

    await resolveException('exc-1', {
      resolver_note: 'Phoned the depot.',
      resolution_method: 'phoned',
    })

    expect(mockedPatch).toHaveBeenCalledWith('/api/v1/exceptions/exc-1/resolve', {
      resolver_note: 'Phoned the depot.',
      resolution_method: 'phoned',
    })
  })

  it('rejects so the caller can surface the failure', async () => {
    // The page previously ran a 600ms timer and then showed an unconditional success
    // toast — reporting a resolution that had never been recorded anywhere.
    mockedPatch.mockRejectedValue(new Error('403 Forbidden'))

    await expect(
      resolveException('exc-1', { resolver_note: 'n', resolution_method: 'phoned' }),
    ).rejects.toThrow('403 Forbidden')
  })
})
