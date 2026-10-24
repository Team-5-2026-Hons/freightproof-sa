import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAsyncData } from './useAsyncData'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Hands out one pending request per call, so a test decides the order responses arrive in.
function queuedFetch(): { fetchFn: () => Promise<string>; requests: Deferred<string>[] } {
  const requests: Deferred<string>[] = []
  const fetchFn = (): Promise<string> => {
    const request = deferred<string>()
    requests.push(request)
    return request.promise
  }
  return { fetchFn, requests }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useAsyncData', () => {
  it('collapses a burst of refetches into one follow-up and applies every response', async () => {
    const { fetchFn, requests } = queuedFetch()
    const { result } = renderHook(() => useAsyncData(fetchFn, 'initial'))

    act(() => { for (let i = 0; i < 10; i++) result.current.refetchSilent() })

    expect(requests).toHaveLength(1)

    await act(async () => { requests[0].resolve('first') })

    // Applied, not discarded for being superseded: the screen moves on while events keep coming.
    expect(result.current.data).toBe('first')
    expect(requests).toHaveLength(2)

    await act(async () => { requests[1].resolve('follow-up') })

    expect(result.current.data).toBe('follow-up')
    expect(requests).toHaveLength(2)
  })

  it('runs no follow-up when nothing was asked for during the request', async () => {
    const { fetchFn, requests } = queuedFetch()
    const { result } = renderHook(() => useAsyncData(fetchFn, 'initial'))

    await act(async () => { requests[0].resolve('only') })

    expect(result.current.data).toBe('only')
    expect(requests).toHaveLength(1)
  })

  it('shows the spinner on the follow-up when a spinner refetch was collapsed into it', async () => {
    const { fetchFn, requests } = queuedFetch()
    const { result } = renderHook(() => useAsyncData(fetchFn, 'initial'))
    act(() => { result.current.refetchSilent(); result.current.refetch() })

    await act(async () => { requests[0].resolve('first') })

    expect(result.current.isLoading).toBe(true)

    await act(async () => { requests[1].resolve('second') })

    expect(result.current.isLoading).toBe(false)
  })

  it('drops a response that lands after its own timeout, and starts the follow-up at the timeout', async () => {
    vi.useFakeTimers()
    const { fetchFn, requests } = queuedFetch()
    const timeoutMs = 1_000
    const { result } = renderHook(() => useAsyncData(fetchFn, 'initial', timeoutMs))
    act(() => { result.current.refetchSilent() })

    act(() => { vi.advanceTimersByTime(timeoutMs) })

    // The follow-up starts at once; the timed-out request's error is superseded by it.
    expect(requests).toHaveLength(2)

    await act(async () => { requests[1].resolve('fresh') })
    await act(async () => { requests[0].resolve('late') })

    expect(result.current.data).toBe('fresh')
    expect(result.current.error).toBeNull()
  })

  it('runs the follow-up after a failure, and reports only an error from the latest attempt', async () => {
    const { fetchFn, requests } = queuedFetch()
    const { result } = renderHook(() => useAsyncData(fetchFn, 'initial'))
    act(() => { result.current.refetchSilent() })

    await act(async () => { requests[0].reject(new Error('first failed')) })

    expect(requests).toHaveLength(2)
    expect(result.current.error).toBeNull()

    await act(async () => { requests[1].reject(new Error('latest failed')) })

    expect(result.current.error).toBe('latest failed')
  })

  it('reports the latest request timing out', () => {
    vi.useFakeTimers()
    const { fetchFn } = queuedFetch()
    const timeoutMs = 1_000
    const { result } = renderHook(() => useAsyncData(fetchFn, 'initial', timeoutMs))

    act(() => { vi.advanceTimersByTime(timeoutMs) })

    expect(result.current.error).toBe('Request timed out. Please try again.')
    expect(result.current.isLoading).toBe(false)
  })
})
