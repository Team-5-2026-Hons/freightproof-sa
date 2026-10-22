// GET /trips/me is shared by every reader on a screen (Home's record, NowCard's place
// names, each step screen) and cached between screens — one request, one answer, and a
// different driver never sees the previous driver's list.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

let mockUserId: string | null = 'driver-a'
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: mockUserId === null ? null : { id: mockUserId } }) }))

const { fetchMyTrips } = vi.hoisted(() => ({ fetchMyTrips: vi.fn() }))
vi.mock('@/lib/api/trips', () => ({ fetchMyTrips }))

import { STALE_AFTER_MS, __resetMyTripsStoreForTests, useMyTrips } from '../useMyTrips'

function summary(id: string): DriverTripSummary {
  return {
    id, trip_reference: `TRP-${id}`, status: 'active', trip_type: 'loaded',
    origin_precinct_id: 'o', destination_precinct_id: 'd', origin_precinct_name: 'Origin depot', destination_precinct_name: 'Dest depot',
    planned_departure_at: null, actual_departure_at: null, planned_arrival_at: null, actual_arrival_at: null,
    needs_review_count: 0, created_at: '2026-10-21T06:00:00Z', updated_at: '2026-10-21T06:00:00Z',
  } as DriverTripSummary
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetMyTripsStoreForTests()
  mockUserId = 'driver-a'
})
afterEach(() => vi.useRealTimers())

describe('useMyTrips shared store', () => {
  it('two readers mounted at once share one request and both get the answer', async () => {
    const request = deferred<DriverTripSummary[]>()
    fetchMyTrips.mockReturnValueOnce(request.promise)

    const first = renderHook(() => useMyTrips())
    const second = renderHook(() => useMyTrips())
    expect(first.result.current.isLoading).toBe(true)
    await act(async () => { request.resolve([summary('1')]); await request.promise })

    expect(fetchMyTrips).toHaveBeenCalledTimes(1)
    expect(first.result.current.trips.map((t) => t.id)).toEqual(['1'])
    expect(second.result.current.trips.map((t) => t.id)).toEqual(['1'])
    expect(second.result.current.isLoading).toBe(false)
  })

  it('a reader mounting while the request is in flight gets the same answer the moment it lands', async () => {
    const request = deferred<DriverTripSummary[]>()
    fetchMyTrips.mockReturnValueOnce(request.promise)
    renderHook(() => useMyTrips())

    // NowCard's situation: it mounts after the working trip loads, mid-request.
    const late = renderHook(() => useMyTrips())
    await act(async () => { request.resolve([summary('1')]); await request.promise })

    expect(fetchMyTrips).toHaveBeenCalledTimes(1)
    expect(late.result.current.trips).toHaveLength(1)
  })

  it('a fresh list is served to the next screen without a request', async () => {
    fetchMyTrips.mockResolvedValueOnce([summary('1')])
    const first = renderHook(() => useMyTrips())
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    first.unmount()

    const next = renderHook(() => useMyTrips())

    expect(next.result.current.isLoading).toBe(false)
    expect(next.result.current.trips).toHaveLength(1)
    expect(fetchMyTrips).toHaveBeenCalledTimes(1)
  })

  it('a stale list is shown at once and refreshed in the background', async () => {
    vi.useFakeTimers()
    fetchMyTrips.mockResolvedValueOnce([summary('1')])
    const first = renderHook(() => useMyTrips())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    first.unmount()
    vi.setSystemTime(Date.now() + STALE_AFTER_MS + 1)
    const refresh = deferred<DriverTripSummary[]>()
    fetchMyTrips.mockReturnValueOnce(refresh.promise)

    const next = renderHook(() => useMyTrips())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(fetchMyTrips).toHaveBeenCalledTimes(2)
    expect(next.result.current.isLoading).toBe(false)
    expect(next.result.current.trips.map((t) => t.id)).toEqual(['1'])
    await act(async () => { refresh.resolve([summary('1'), summary('2')]); await refresh.promise })
    expect(next.result.current.trips.map((t) => t.id)).toEqual(['1', '2'])
  })

  it('reload forces a request and keeps the current list visible while it runs', async () => {
    fetchMyTrips.mockResolvedValueOnce([summary('1')])
    const { result } = renderHook(() => useMyTrips())
    await waitFor(() => expect(result.current.trips).toHaveLength(1))
    const again = deferred<DriverTripSummary[]>()
    fetchMyTrips.mockReturnValueOnce(again.promise)

    act(() => result.current.reload())

    expect(fetchMyTrips).toHaveBeenCalledTimes(2)
    expect(result.current.trips).toHaveLength(1)
    expect(result.current.isLoading).toBe(false)
  })

  it('a failed request is surfaced and the next mount tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMyTrips.mockRejectedValueOnce(new Error('offline'))
    const first = renderHook(() => useMyTrips())
    await waitFor(() => expect(first.result.current.loadError).not.toBeNull())
    expect(first.result.current.isLoading).toBe(false)
    first.unmount()
    fetchMyTrips.mockResolvedValueOnce([summary('1')])

    const next = renderHook(() => useMyTrips())
    await waitFor(() => expect(next.result.current.trips).toHaveLength(1))

    expect(fetchMyTrips).toHaveBeenCalledTimes(2)
    expect(next.result.current.loadError).toBeNull()
  })

  it('a different driver never sees the previous driver\'s list', async () => {
    const slow = deferred<DriverTripSummary[]>()
    fetchMyTrips.mockReturnValueOnce(slow.promise)
    const { result, rerender } = renderHook(() => useMyTrips())
    fetchMyTrips.mockResolvedValueOnce([summary('b1')])

    mockUserId = 'driver-b'
    rerender()
    await waitFor(() => expect(result.current.trips.map((t) => t.id)).toEqual(['b1']))
    // Driver A's late answer must not overwrite driver B's list.
    await act(async () => { slow.resolve([summary('a1')]); await slow.promise })

    expect(result.current.trips.map((t) => t.id)).toEqual(['b1'])
  })

  it('signing out clears the list and makes no request', async () => {
    fetchMyTrips.mockResolvedValueOnce([summary('1')])
    const { result, rerender } = renderHook(() => useMyTrips())
    await waitFor(() => expect(result.current.trips).toHaveLength(1))

    mockUserId = null
    rerender()

    expect(result.current.trips).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(fetchMyTrips).toHaveBeenCalledTimes(1)
  })
})
