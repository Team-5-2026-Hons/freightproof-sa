import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api/client'
import { fleetPath, useFleetQuery, useFleetTiles } from './useFleetAnalytics'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

interface Answer {
  value: number
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('useFleetQuery', () => {
  it('requests the tiles endpoint', async () => {
    mockedGet.mockResolvedValue({})

    renderHook(() => useFleetTiles())

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1))
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/analytics/fleet/tiles')
  })

  it('is loading, not refreshing, before the first answer', () => {
    mockedGet.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useFleetQuery<Answer>('/first'))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isRefreshing).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it('keeps the previous answer while a new path loads', async () => {
    const next = deferred<Answer>()
    mockedGet.mockResolvedValueOnce({ value: 1 }).mockReturnValueOnce(next.promise)
    const { result, rerender } = renderHook(
      ({ path }) => useFleetQuery<Answer>(path), { initialProps: { path: '/first' } },
    )
    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }))

    rerender({ path: '/second' })

    expect(result.current.data).toEqual({ value: 1 })
    expect(result.current.isRefreshing).toBe(true)
    expect(result.current.isLoading).toBe(false)
    await act(async () => { next.resolve({ value: 2 }) })
    expect(result.current.data).toEqual({ value: 2 })
    expect(result.current.isRefreshing).toBe(false)
  })

  it('clears the previous answer when the new request fails', async () => {
    mockedGet.mockResolvedValueOnce({ value: 1 }).mockRejectedValueOnce(new Error('Server unavailable'))
    const { result, rerender } = renderHook(
      ({ path }) => useFleetQuery<Answer>(path), { initialProps: { path: '/first' } },
    )
    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }))

    rerender({ path: '/second' })

    await waitFor(() => expect(result.current.error).toBe('Server unavailable'))
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('drops an older reply that arrives after a newer one', async () => {
    const older = deferred<Answer>()
    const newer = deferred<Answer>()
    mockedGet.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const { result, rerender } = renderHook(
      ({ path }) => useFleetQuery<Answer>(path), { initialProps: { path: '/first' } },
    )

    rerender({ path: '/second' })
    await act(async () => { newer.resolve({ value: 2 }) })
    await act(async () => { older.resolve({ value: 1 }) })

    expect(result.current.data).toEqual({ value: 2 })
  })

  it('refetches on demand after a failure', async () => {
    mockedGet.mockRejectedValueOnce(new Error('transient')).mockResolvedValue({ value: 3 })
    const { result } = renderHook(() => useFleetQuery<Answer>('/first'))
    await waitFor(() => expect(result.current.error).toBe('transient'))

    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.data).toEqual({ value: 3 }))
    expect(result.current.error).toBeNull()
  })
})

describe('fleetPath', () => {
  it('sends start, end and grain for a trend', () => {
    expect(fleetPath('activity', { start: '2026-06-29', end: '2026-09-16', grain: 'week' }, null))
      .toBe('/api/v1/analytics/fleet/activity?start=2026-06-29&end=2026-09-16&grain=week')
  })

  it('leaves the start out for All time', () => {
    expect(fleetPath('patterns', { start: null, end: '2026-09-16' }, null))
      .toBe('/api/v1/analytics/fleet/patterns?end=2026-09-16')
    expect(fleetPath('activity', { start: null, end: '2026-09-16', grain: 'month' }, '2026-06-20'))
      .toBe('/api/v1/analytics/fleet/activity?end=2026-09-16&grain=month')
  })

  it('waits on an All-time trend until the page knows where All time starts', () => {
    expect(fleetPath('activity', { start: null, end: '2026-09-16', grain: 'week' }, null)).toBeNull()
  })
})

describe('useFleetQuery without a path', () => {
  it('waits without requesting anything', () => {
    const { result } = renderHook(() => useFleetQuery<Answer>(null))

    expect(mockedGet).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(true)
  })
})
