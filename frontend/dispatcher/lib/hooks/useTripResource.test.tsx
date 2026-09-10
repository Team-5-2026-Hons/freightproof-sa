import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api/client'
import { useRealtimeChannel } from '@/lib/realtime/RealtimeProvider'
import type { RealtimeEvent } from '@/lib/realtime/types'
import { useManifest } from './useManifest'
import { useTripDetail } from './useTripDetail'
import { useTripArtifacts } from './useTripArtifacts'
import { __resetTripResourceCache, clearTripResourceCache } from './useTripResource'
import { clearSessionCaches } from '@/lib/cache/sessionCache'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class extends Error { constructor(public status: number, message: string) { super(message) } },
}))
vi.mock('@/lib/realtime/RealtimeProvider', () => ({ useRealtimeChannel: vi.fn() }))
const listeners = new Set<(event: RealtimeEvent) => void>()
const subscribe = (listener: (event: RealtimeEvent) => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve!: (value: unknown) => void
  return { promise: new Promise<unknown>(done => { resolve = done }), resolve: value => resolve(value) }
}
async function flush(): Promise<void> { await act(async () => { await Promise.resolve() }) }
function emit(id: string): void {
  const event: RealtimeEvent = { resource: 'trip', id, kind: 'phase_completed', severity: 'info', ts: new Date().toISOString() }
  listeners.forEach(listener => listener(event))
}
beforeEach(() => {
  __resetTripResourceCache()
  vi.useFakeTimers()
  vi.mocked(api.get).mockReset()
  vi.mocked(useRealtimeChannel).mockReturnValue({ status: 'live', subscribe, reconnectNonce: 0 })
})
afterEach(() => { listeners.clear(); vi.useRealTimers() })

describe('trip resource recovery', () => {
  it.each([404, 500, 0])('keeps the manifest failure status %s distinct', async status => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(status, 'Unavailable'))
    const { result } = renderHook(() => useManifest('a'))
    await flush()
    expect(result.current).toMatchObject({ manifest: null, error: 'Unavailable', errorStatus: status, isLoading: false })
  })
  it('preserves content and its timestamp through failure and retry', async () => {
    const manifest = { id: 'manifest-a' }
    vi.mocked(api.get).mockResolvedValueOnce(manifest).mockRejectedValueOnce(new ApiError(500, 'Unavailable')).mockResolvedValueOnce({ id: 'recovered' })
    const { result } = renderHook(() => useManifest('a'))
    await flush()
    const timestamp = result.current.lastUpdated
    act(() => result.current.refetchSilent())
    await flush()
    expect(result.current).toMatchObject({ manifest, lastUpdated: timestamp, errorStatus: 500, isLoading: false })
    act(() => result.current.refetch())
    expect(result.current.errorStatus).toBe(500)
    expect(result.current.isLoading).toBe(false)
    await flush()
    expect(result.current).toMatchObject({ manifest: { id: 'recovered' }, error: null, errorStatus: null })
  })
  it('never replaces a newer successful response with an older response', async () => {
    const older = deferred()
    vi.mocked(api.get).mockReturnValueOnce(older.promise).mockResolvedValueOnce({ id: 'new' })
    const { result } = renderHook(() => useTripDetail('a'))
    await flush()
    act(() => result.current.refetch())
    await flush()
    await act(async () => older.resolve({ id: 'old' }))
    expect(result.current.trip).toEqual({ id: 'new' })
  })
  it('clears previous-trip evidence and rejects old results after an ID switch', async () => {
    const old = deferred()
    const next = deferred()
    vi.mocked(api.get).mockResolvedValueOnce({ id: 'a' }).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const { result, rerender } = renderHook(({ id }) => useTripDetail(id), { initialProps: { id: 'a' } })
    await flush()
    act(() => result.current.refetch())
    await flush()
    rerender({ id: 'b' })
    expect(result.current).toMatchObject({ trip: null, isLoading: true, error: null, lastUpdated: null })
    await act(async () => old.resolve({ id: 'a-old' }))
    expect(result.current.trip).toBeNull()
    await act(async () => next.resolve({ id: 'b' }))
    expect(result.current.trip).toEqual({ id: 'b' })
  })
  it('bounds stalled requests and ignores their late completion', async () => {
    const pending = deferred()
    vi.mocked(api.get).mockReturnValue(pending.promise)
    const { result } = renderHook(() => useManifest('a'))
    await flush()
    await act(async () => vi.advanceTimersByTime(25_000))
    expect(result.current).toMatchObject({ errorStatus: 0, isLoading: false })
    await act(async () => pending.resolve({ id: 'late' }))
    expect(result.current.manifest).toBeNull()
  })
  it('refreshes mounted resources once per burst and on reconnect; cancels on unmount', async () => {
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/artifacts') ? [] : { id: 'a' })
    const { result, rerender, unmount } = renderHook(() => ({ trip: useTripDetail('a'), artifacts: useTripArtifacts('a'), manifest: useManifest('a') }))
    await flush()
    expect(api.get).toHaveBeenCalledTimes(3)
    act(() => emit('other'))
    await act(async () => vi.advanceTimersByTime(200))
    expect(api.get).toHaveBeenCalledTimes(3)
    act(() => { emit('a'); emit('a'); emit('a') })
    await act(async () => vi.advanceTimersByTime(200))
    expect(api.get).toHaveBeenCalledTimes(6)
    expect(result.current.trip.isLoading).toBe(false)
    vi.mocked(useRealtimeChannel).mockReturnValue({ status: 'live', subscribe, reconnectNonce: 1 })
    rerender()
    await act(async () => vi.advanceTimersByTime(200))
    expect(api.get).toHaveBeenCalledTimes(9)
    act(() => emit('a'))
    unmount()
    await act(async () => vi.advanceTimersByTime(200))
    expect(api.get).toHaveBeenCalledTimes(9)
    expect(listeners.size).toBe(0)
  })
})

describe('forgetting the signed-in dispatcher\'s records', () => {
  it('drops what a cached URL holds instead of answering the next reader from it', async () => {
    const trip = { id: 'trip-a', trip_reference: 'FP-A' }
    vi.mocked(api.get).mockResolvedValue(trip)
    const first = renderHook(() => useTripDetail('a'))
    await flush()
    expect(first.result.current.trip).toEqual(trip)
    first.unmount()

    // Whoever signs in next must not be shown this from memory: the server would refuse
    // the revalidation behind it, and the resource layer deliberately keeps the last
    // successful response through a failure — so a cached record would simply stay.
    act(() => { clearTripResourceCache() })
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, 'Forbidden'))
    const second = renderHook(() => useTripDetail('a'))
    expect(second.result.current.trip).toBeNull()
    await flush()
    expect(second.result.current).toMatchObject({ trip: null, errorStatus: 403 })
  })

  it('re-reads the record for a page that is still mounted when the identity changes', async () => {
    vi.mocked(api.get).mockResolvedValue({ id: 'trip-a', trip_reference: 'FP-A' })
    const { result } = renderHook(() => useTripDetail('a'))
    await flush()
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1)

    // A mounted hook holds a direct reference to its cache entry, so emptying the Map
    // alone would leave it bound to a record nothing will publish to again — showing the
    // previous dispatcher's trip until something else forced a render.
    vi.mocked(api.get).mockResolvedValue({ id: 'trip-a', trip_reference: 'FP-B' })
    await act(async () => { clearSessionCaches(); await Promise.resolve() })
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2)
    expect(result.current.trip).toEqual({ id: 'trip-a', trip_reference: 'FP-B' })
  })

  it('is reachable through the session registry, not only by direct call', async () => {
    vi.mocked(api.get).mockResolvedValue({ id: 'manifest-a' })
    const { result, unmount } = renderHook(() => useManifest('a'))
    await flush()
    expect(result.current.manifest).toEqual({ id: 'manifest-a' })
    unmount()

    act(() => { clearSessionCaches() })
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}) as never)
    const second = renderHook(() => useManifest('a'))
    expect(second.result.current).toMatchObject({ manifest: null, isLoading: true })
  })
})

describe('a record the server refuses to serve', () => {
  it.each([401, 403, 404])('drops what it held when the server answers %s', async status => {
    const trip = { id: 'trip-a', trip_reference: 'FP-A' }
    vi.mocked(api.get).mockResolvedValueOnce(trip)
    const { result } = renderHook(() => useTripDetail('a'))
    await flush()
    expect(result.current.trip).toEqual(trip)

    vi.mocked(api.get).mockRejectedValue(new ApiError(status, 'Refused'))
    act(() => result.current.refetch())
    await flush()

    // Answering a refusal by leaving the record on screen is the client overruling the
    // server on access. 404 counts: it is how this backend replies for another
    // organisation's trip, so that the response does not leak that it exists.
    expect(result.current.trip).toBeNull()
    expect(result.current.errorStatus).toBe(status)
  })

  it('leaves nothing behind for the next mount to show', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ id: 'trip-a' })
    const first = renderHook(() => useTripDetail('a'))
    await flush()
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, 'Refused'))
    act(() => first.result.current.refetch())
    await flush()
    first.unmount()

    vi.mocked(api.get).mockReturnValue(new Promise(() => {}) as never)
    const second = renderHook(() => useTripDetail('a'))

    // lastUpdated had to be cleared alongside the data: it is what decides whether a
    // mount shows a loading state or renders behind a silent revalidation.
    expect(second.result.current).toMatchObject({ trip: null, isLoading: true })
  })

  it('still keeps the record through a failure that is not a refusal', async () => {
    const trip = { id: 'trip-a', trip_reference: 'FP-A' }
    vi.mocked(api.get).mockResolvedValueOnce(trip)
    const { result } = renderHook(() => useTripDetail('a'))
    await flush()

    vi.mocked(api.get).mockRejectedValue(new ApiError(500, 'Unavailable'))
    act(() => result.current.refetch())
    await flush()

    // A 500 or a timeout means the fetch failed, not that the record stopped being this
    // dispatcher's. Blanking an evidence page over a flaky network is the worse outcome.
    expect(result.current.trip).toEqual(trip)
    expect(result.current.errorStatus).toBe(500)
  })
})
