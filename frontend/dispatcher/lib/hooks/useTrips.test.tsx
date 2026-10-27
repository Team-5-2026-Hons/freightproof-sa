import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import { useRealtimeChannel } from '@/lib/realtime/RealtimeProvider'
import type { RealtimeEvent, RealtimeKind } from '@/lib/realtime/types'
import { RECONCILE_INTERVAL_MS, useTrips } from './useTrips'

vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }))
vi.mock('@/lib/realtime/RealtimeProvider', () => ({ useRealtimeChannel: vi.fn() }))

const listeners = new Set<(event: RealtimeEvent) => void>()
const subscribe = (listener: (event: RealtimeEvent) => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function emit(kind: RealtimeKind): void {
  const event: RealtimeEvent = { resource: 'trip', id: 'trip-a', kind, severity: 'info', ts: new Date().toISOString() }
  listeners.forEach(listener => listener(event))
}
async function flush(): Promise<void> { await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockResolvedValue([])
  vi.mocked(useRealtimeChannel).mockReturnValue({ status: 'live', subscribe, reconnectNonce: 0 })
})
afterEach(() => { listeners.clear() })

describe('live trip list', () => {
  it('live trip list ignores evidence_uploaded', async () => {
    const { unmount } = renderHook(() => useTrips())
    await flush()
    expect(api.get).toHaveBeenCalledTimes(1)

    act(() => emit('evidence_uploaded'))
    await flush()

    expect(api.get).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('refreshes on a kind that changes the trip record', async () => {
    const { unmount } = renderHook(() => useTrips())
    await flush()

    act(() => emit('phase_completed'))
    await flush()

    expect(api.get).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('refreshes on reconnect', async () => {
    const { rerender, unmount } = renderHook(() => useTrips())
    await flush()

    vi.mocked(useRealtimeChannel).mockReturnValue({ status: 'live', subscribe, reconnectNonce: 1 })
    rerender()
    await flush()

    expect(api.get).toHaveBeenCalledTimes(2)
    unmount()
  })
})

describe('reconciliation', () => {
  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('refetches on an interval, so a dropped event cannot leave the list stale for long', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useTrips())
    await flush()

    act(() => { vi.advanceTimersByTime(RECONCILE_INTERVAL_MS) })
    await flush()

    expect(api.get).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('does not refetch on the interval while the tab is hidden', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useTrips())
    await flush()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })

    act(() => { vi.advanceTimersByTime(RECONCILE_INTERVAL_MS) })
    await flush()

    expect(api.get).toHaveBeenCalledTimes(1)
    unmount()
  })
})
