import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRealtimeChannel } from './RealtimeProvider'
import { useLiveResource } from './useLiveResource'
import type { EventSeverity, RealtimeEvent, RealtimeKind } from './types'

vi.mock('./RealtimeProvider', () => ({
  useRealtimeChannel: vi.fn(),
}))

type Listener = (event: RealtimeEvent) => void

const subscribe = vi.fn<(listener: Listener) => () => void>()
let listener: Listener | undefined

function event(kind: RealtimeKind, severity: EventSeverity = 'info'): RealtimeEvent {
  return {
    resource: 'trip',
    id: crypto.randomUUID(),
    kind,
    severity,
    ts: new Date().toISOString(),
  }
}

describe('useLiveResource kind filtering', () => {
  beforeEach(() => {
    listener = undefined
    subscribe.mockReset()
    subscribe.mockImplementation((nextListener) => {
      listener = nextListener
      return () => undefined
    })
    vi.mocked(useRealtimeChannel).mockReturnValue({
      status: 'live',
      subscribe,
      reconnectNonce: 0,
    })
  })

  it('does not refetch for an unrelated realtime kind', () => {
    const refetch = vi.fn()
    renderHook(() => useLiveResource(
      'trip',
      'any',
      refetch,
      { kinds: ['exception_raised', 'exception_reviewed'] },
    ))

    act(() => listener?.(event('phase_completed')))

    expect(refetch).not.toHaveBeenCalled()
  })

  it('refetches for each selected realtime kind', () => {
    const refetch = vi.fn()
    renderHook(() => useLiveResource(
      'trip',
      'any',
      refetch,
      { kinds: ['exception_raised', 'exception_reviewed'] },
    ))

    act(() => {
      listener?.(event('exception_raised', 'warning'))
      listener?.(event('exception_reviewed'))
    })

    expect(refetch).toHaveBeenCalledTimes(2)
  })
})
