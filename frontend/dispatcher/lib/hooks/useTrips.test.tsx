import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import { useRealtimeChannel } from '@/lib/realtime/RealtimeProvider'
import type { RealtimeEvent, RealtimeKind } from '@/lib/realtime/types'
import { useTrips } from './useTrips'

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

    // A photo upload changes no list row (status, needs-review count), so refetching
    // every trip on each upload would be wasted load.
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
