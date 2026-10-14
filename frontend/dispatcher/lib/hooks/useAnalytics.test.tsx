import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import type { MonthRange } from '@/lib/types/month-range'
import type { FacilityMetrics } from '@shared/lib/types/analytics'
import {
  useDriverAnalytics,
  useFacilityAnalytics,
  useVehicleAnalytics,
  useVehicleStreaks,
} from './useAnalytics'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

const RANGE: MonthRange = { start: '2026-07-01', end: '2026-09-01' }
const QUERY = 'start_month=2026-07-01&end_month=2026-09-01'

function makeFacility(overrides: Partial<FacilityMetrics> = {}): FacilityMetrics {
  return {
    precinct_id: 'c0c3312c-d68d-4346-9508-5fefbc64489a' as FacilityMetrics['precinct_id'],
    precinct_name: 'Durban Depot',
    confirmed_count: 2,
    mismatch_count: 1,
    unwitnessed_count: 4,
    corroboration_rate: 2 / 3,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('analytics hooks', () => {
  it.each([
    ['facilities', useFacilityAnalytics],
    ['vehicles', useVehicleAnalytics],
    ['drivers', useDriverAnalytics],
  ] as const)('requests /%s with the inclusive month range', async (grain, useGrain) => {
    mockedGet.mockResolvedValue([])

    renderHook(() => useGrain(RANGE))

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))
    expect(mockedGet).toHaveBeenCalledWith(`/api/v1/analytics/${grain}?${QUERY}`)
  })

  it('requests streaks without a month range', async () => {
    mockedGet.mockResolvedValue([])

    renderHook(() => useVehicleStreaks())

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/analytics/vehicles/streaks')
  })

  it('returns the rows and no error on success', async () => {
    mockedGet.mockResolvedValue([makeFacility()])

    const { result } = renderHook(() => useFacilityAnalytics(RANGE))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.rows).toEqual([makeFacility()])
    expect(result.current.error).toBeNull()
  })

  // Before the FP-153 migration reaches Supabase the backend answers 500; that failure
  // must reach the panel's error state, not read as an empty table.
  it('surfaces the error and no rows when the request fails', async () => {
    mockedGet.mockRejectedValue(new Error('Internal server error.'))

    const { result } = renderHook(() => useFacilityAnalytics(RANGE))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('Internal server error.')
    expect(result.current.rows).toEqual([])
  })

  it('refetches on demand after a failure', async () => {
    mockedGet
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue([makeFacility()])
    const { result } = renderHook(() => useFacilityAnalytics(RANGE))
    await waitFor(() => expect(result.current.error).toBe('transient'))

    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.error).toBeNull()
  })

  it('clears the previous range\'s rows while the new range loads', async () => {
    const pending = deferred<FacilityMetrics[]>()
    mockedGet.mockResolvedValueOnce([makeFacility()]).mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderHook(
      ({ range }) => useFacilityAnalytics(range), { initialProps: { range: RANGE } },
    )
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    rerender({ range: { start: '2026-09-01', end: '2026-09-01' } })

    expect(result.current.rows).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('keeps the newest range when an older response arrives last', async () => {
    const older = deferred<FacilityMetrics[]>()
    const newer = deferred<FacilityMetrics[]>()
    mockedGet.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const { result, rerender } = renderHook(
      ({ range }) => useFacilityAnalytics(range), { initialProps: { range: RANGE } },
    )

    rerender({ range: { start: '2026-09-01', end: '2026-09-01' } })
    await act(async () => { newer.resolve([makeFacility({ confirmed_count: 9 })]) })
    await act(async () => { older.resolve([makeFacility({ confirmed_count: 1 })]) })

    expect(mockedGet).toHaveBeenCalledTimes(2)
    expect(result.current.rows.map((row) => row.confirmed_count)).toEqual([9])
  })

  it('does not refetch when re-rendered with an equal range', async () => {
    mockedGet.mockResolvedValue([])
    const { rerender } = renderHook(
      ({ range }) => useFacilityAnalytics(range), { initialProps: { range: RANGE } },
    )
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))

    // A fresh object with the same months — what a page re-render produces.
    rerender({ range: { ...RANGE } })

    expect(mockedGet).toHaveBeenCalledTimes(1)
  })
})
